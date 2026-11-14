# A quiz: a class, a loop, and a score. Good for testing input(), not just print().
QUESTIONS = [
    ("What is 7 * 6?", "42"),
    ("What is the capital of Pakistan?", "islamabad"),
    ("Which language is this app written in?", "python"),
]


class Quiz:
    def __init__(self, questions):
        self.questions = questions
        self.score = 0

    def ask_all(self):
        for number, (question, expected) in enumerate(self.questions, start=1):
            answer = input(f"{number}. {question} ")
            self.check(answer, expected)

    def check(self, answer, expected):
        if answer.strip().lower() == expected:
            self.score += 1
            print("Correct.")
        else:
            print(f"Not quite. The answer is {expected}.")

    def finish(self):
        total = len(self.questions)
        print(f"\nScore: {self.score} of {total}")
        if self.score == total:
            print("Perfect.")


quiz = Quiz(QUESTIONS)
quiz.ask_all()
quiz.finish()
