/**
 * The Python side of an embedded Python app (see src/lib/pyapp.ts). It runs in
 * Pyodide, in the visitor's browser, never on this server.
 *
 * A browser cannot block, so an ordinary console program needs two things
 * rewritten before it runs: input() becomes an awaited read from the page, and
 * every function that (transitively) asks for input becomes a coroutine that
 * is awaited where it is called. ams_transform does that on the AST, so line
 * numbers in a traceback are still the writer's own.
 *
 * Kept as String.raw so the Python is byte-for-byte what is executed;
 * tests/pyapp.test.mjs runs this exact string in a real Pyodide when the
 * optional "pyodide" package is installed.
 */
export const PY_BOOTSTRAP = String.raw`import ast, base64, builtins, inspect, json, linecache, os, sys, traceback

_BUILTINS = set(dir(builtins))
# Callee names that must be awaited where they are called; the pass below then
# turns every function that reaches one of them into a coroutine.
_SEED = {'input', 'ams_pick_file'}
_NO_ASYNC_DECOS = {'property', 'cached_property', 'setter', 'getter', 'contextmanager'}

# Files cross postMessage as base64, so both directions are bounded.
_MAX_FILE = 20 * 1024 * 1024
_UPLOAD_DIR = '/home/pyodide/uploads'
_MIME = {
    'pdf': 'application/pdf', 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp', 'svg': 'image/svg+xml',
    'csv': 'text/csv', 'txt': 'text/plain', 'md': 'text/markdown', 'json': 'application/json',
    'html': 'text/html', 'zip': 'application/zip', 'mp3': 'audio/mpeg', 'mp4': 'video/mp4',
}


def _clean_name(name, fallback='file'):
    """Just a file name: no directories, no control characters, no surprises."""
    text = str(name or '').replace('\\', '/').split('/')[-1]
    kept = ''.join(ch for ch in text if ch.isalnum() or ch in '._- ')
    return kept.strip(' .')[:80] or fallback


def _mime_for(name):
    return _MIME.get(name.rsplit('.', 1)[-1].lower(), 'application/octet-stream') if '.' in name else 'application/octet-stream'


def _callee(node):
    f = node.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return None


def _own_nodes(fn):
    """Nodes of a function body, not descending into nested defs/lambdas/classes."""
    stack = list(fn.body)
    while stack:
        node = stack.pop()
        yield node
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                continue
            stack.append(child)


def _convertible(fn):
    name = fn.name
    if name.startswith('__') and name.endswith('__') and name != '__init__':
        return False
    for deco in fn.decorator_list:
        d = deco
        if isinstance(d, ast.Call):
            d = d.func
        label = d.id if isinstance(d, ast.Name) else d.attr if isinstance(d, ast.Attribute) else ''
        if label in _NO_ASYNC_DECOS:
            return False
    for node in _own_nodes(fn):
        if isinstance(node, (ast.Yield, ast.YieldFrom)):
            return False
    return True


class _Plan(ast.NodeVisitor):
    """Collects every def with the class it lives in, and the module's known names."""

    def __init__(self):
        self.funcs = []          # (FunctionDef, ClassDef | None)
        self.classes = {}        # name -> ClassDef
        self.known = set()       # sync callables that never need wrapping
        self._cls = []

    def visit_ClassDef(self, node):
        self.classes[node.name] = node
        self.known.add(node.name)
        self._cls.append(node)
        self.generic_visit(node)
        self._cls.pop()

    def visit_FunctionDef(self, node):
        direct = bool(self._cls) and node in self._cls[-1].body
        self.funcs.append((node, self._cls[-1] if direct else None))
        self.known.add(node.name)
        saved, self._cls = self._cls, []
        self.generic_visit(node)
        self._cls = saved

    def visit_Import(self, node):
        for alias in node.names:
            self.known.add((alias.asname or alias.name).split('.')[0])

    def visit_ImportFrom(self, node):
        for alias in node.names:
            self.known.add(alias.asname or alias.name)


def _plan(tree):
    plan = _Plan()
    plan.visit(tree)
    names = set(_SEED)        # callee names that must be awaited
    async_init = set()        # classes built through __ams_init__
    marked = set()            # id(FunctionDef) to convert
    changed = True
    while changed:
        changed = False
        for name, cls in plan.classes.items():
            if name in async_init:
                continue
            if any(isinstance(b, ast.Name) and b.id in async_init for b in cls.bases):
                async_init.add(name)
                names.add(name)
                changed = True
        for fn, cls in plan.funcs:
            if id(fn) in marked or not _convertible(fn):
                continue
            hit = False
            for node in _own_nodes(fn):
                if not isinstance(node, ast.Call):
                    continue
                callee = _callee(node)
                if callee in names or (callee == '__init__' and async_init):
                    hit = True
                    break
            if not hit:
                continue
            marked.add(id(fn))
            changed = True
            if fn.name == '__init__':
                if cls is not None:
                    async_init.add(cls.name)
                    names.add(cls.name)
            else:
                names.add(fn.name)
    return plan, names, async_init, marked


def _name(id_, node):
    return ast.copy_location(ast.Name(id=id_, ctx=ast.Load()), node)


class _Rewrite(ast.NodeTransformer):
    def __init__(self, plan, names, async_init, marked):
        self.known = plan.known - names
        self.names, self.async_init, self.marked = names, async_init, marked
        self.ctx = [True]         # module level runs with top-level await

    def _scoped(self, node, flag):
        self.ctx.append(flag)
        self.generic_visit(node)
        self.ctx.pop()
        return node

    def visit_ClassDef(self, node):
        return self._scoped(node, False)     # a class body cannot await

    def visit_Lambda(self, node):
        return self._scoped(node, False)

    def visit_GeneratorExp(self, node):
        return self._scoped(node, False)

    def visit_AsyncFunctionDef(self, node):
        return self._scoped(node, True)

    def visit_FunctionDef(self, node):
        if id(node) not in self.marked:
            return self._scoped(node, False)
        self._scoped(node, True)
        new = ast.AsyncFunctionDef(
            name='__ams_init__' if node.name == '__init__' else node.name,
            args=node.args, body=node.body, decorator_list=node.decorator_list,
            returns=node.returns, type_comment=getattr(node, 'type_comment', None),
        )
        if hasattr(node, 'type_params'):
            new.type_params = node.type_params
        return ast.copy_location(new, node)

    def _await(self, helper, node, extra):
        call = ast.Call(func=_name(helper, node), args=extra + node.args, keywords=node.keywords)
        return ast.copy_location(ast.Await(value=ast.copy_location(call, node)), node)

    def visit_Call(self, node):
        self.generic_visit(node)
        if not self.ctx[-1]:
            return node
        f = node.func
        if isinstance(f, ast.Name):
            if f.id == 'input':
                return self._await('__ams_input__', node, [])
            if f.id in self.names:
                return self._await('__ams_call__', node, [f])
            if f.id in self.known or f.id in _BUILTINS or f.id.startswith('__ams_'):
                return node
            return self._await('__ams_call__', node, [f])      # a callback held in a variable
        if isinstance(f, ast.Attribute):
            if f.attr == '__init__' and self.async_init:
                return self._await('__ams_superinit__', node, [f.value])
            if f.attr in self.names:
                return self._await('__ams_call__', node, [f])
            return node
        return self._await('__ams_call__', node, [f])          # table[key](...), make()()


async def __ams_call__(f, *a, **k):
    if isinstance(f, type) and hasattr(f, '__ams_init__'):
        obj = f.__new__(f)
        await obj.__ams_init__(*a, **k)
        return obj
    r = f(*a, **k)
    if inspect.iscoroutine(r):
        r = await r
    return r


async def __ams_superinit__(target, *a, **k):
    f = getattr(target, '__ams_init__', None)
    if f is None:
        return target.__init__(*a, **k)
    return await f(*a, **k)


def _sync_input(prompt=''):
    raise RuntimeError(
        'input() was called from a place that cannot wait for the page '
        '(a lambda, a property, a generator or a special method such as __str__). '
        'Move it into a normal function.')


class _Out:
    encoding = 'utf-8'

    def __init__(self, send, kind):
        self._send, self._kind = send, kind

    def write(self, s):
        if not isinstance(s, str):
            s = str(s)
        if s:
            self._send(self._kind, s)
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return False

    def writable(self):
        return True


def _show_figures(send):
    def show(*a, **k):
        import base64, io
        import matplotlib.pyplot as plt
        for num in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(num).savefig(buf, format='png', bbox_inches='tight', dpi=110)
            send('img', 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii'))
        plt.close('all')
    return show


def ams_transform(source, filename='app.py'):
    tree = ast.parse(source, filename)
    plan, names, async_init, marked = _plan(tree)
    tree = _Rewrite(plan, names, async_init, marked).visit(tree)
    ast.fix_missing_locations(tree)
    return tree


async def ams_run(source, filename, send, read_line, read_file):
    """Run one program: send(kind, value) prints, read_line() awaits a line,
    read_file() awaits a file the visitor picked."""
    sys.stdout = _Out(send, 'out')
    sys.stderr = _Out(send, 'err')

    async def __ams_input__(prompt=''):
        if prompt != '':
            sys.stdout.write(str(prompt))
        line = await read_line()
        if line is None:
            raise EOFError('EOF when reading a line')
        return str(line)

    async def __ams_pick_file__(accept='*/*', multiple=False):
        """Put a file the visitor chose into the program's filesystem.

        Returns its path (or a list of paths), so ordinary code works as
        written: Image.open(path), open(path, 'rb'), pandas.read_csv(path).
        """
        raw = await read_file(json.dumps({'accept': str(accept or '*/*'), 'multiple': bool(multiple)}))
        answers = json.loads(raw) if raw else None
        if not answers:
            return None
        try:
            os.makedirs(_UPLOAD_DIR, exist_ok=True)
        except OSError:
            pass
        paths = []
        for item in answers:
            data = base64.b64decode(str(item.get('data') or ''))
            if len(data) > _MAX_FILE:
                raise RuntimeError('That file is larger than the 20 MB this terminal accepts.')
            name = _clean_name(item.get('name'))
            stem, ext = os.path.splitext(name)
            path = os.path.join(_UPLOAD_DIR, name)
            counter = 1
            while os.path.exists(path):
                path = os.path.join(_UPLOAD_DIR, '%s-%d%s' % (stem, counter, ext))
                counter += 1
            with open(path, 'wb') as handle:
                handle.write(data)
            paths.append(path)
        return paths if multiple else paths[0]

    def __ams_download__(path, name=None):
        """Hand a file the program made to the visitor as a download link."""
        target = str(path)
        try:
            with open(target, 'rb') as handle:
                data = handle.read()
        except OSError:
            raise FileNotFoundError('ams_download could not read ' + target + ' - write the file first.')
        if len(data) > _MAX_FILE:
            raise RuntimeError('That file is larger than the 20 MB this terminal can hand back.')
        label = _clean_name(name or os.path.basename(target))
        send('file', json.dumps({'name': label, 'mime': _mime_for(label), 'data': base64.b64encode(data).decode('ascii')}))

    builtins.input = _sync_input
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    scope = {
        '__name__': '__main__', '__file__': filename, '__builtins__': builtins,
        '__ams_input__': __ams_input__, '__ams_call__': __ams_call__,
        '__ams_superinit__': __ams_superinit__,
        'ams_pick_file': __ams_pick_file__, 'ams_download': __ams_download__,
    }
    if 'matplotlib' in source:
        try:
            import matplotlib
            matplotlib.use('AGG')
            import matplotlib.pyplot as plt
            plt.show = _show_figures(send)
        except Exception:
            pass
    status = 'done'
    try:
        code = compile(ams_transform(source, filename), filename, 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        result = eval(code, scope)
        if inspect.iscoroutine(result):
            await result
        plt = sys.modules.get('matplotlib.pyplot')
        if plt is not None and plt.get_fignums():
            plt.show()
    except SystemExit as exc:
        if exc.code not in (None, 0):
            if not isinstance(exc.code, int):
                send('err', str(exc.code) + '\n')
            status = 'error'
    except BaseException:
        kind, value, tb = sys.exc_info()
        # Drop this runner's own frames: the writer wants their file's lines.
        frames = [f for f in traceback.extract_tb(tb) if f.filename == filename]
        text = 'Traceback (most recent call last):\n' + ''.join(traceback.format_list(frames)) if frames else ''
        send('err', text + ''.join(traceback.format_exception_only(kind, value)))
        status = 'error'
    return status
`;
