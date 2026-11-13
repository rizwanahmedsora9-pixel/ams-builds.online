(function () {
  'use strict';
  var button = document.querySelector('.nav-toggle');
  var navigation = document.getElementById('primary-navigation');
  if (!button || !navigation) return;
  button.addEventListener('click', function () {
    var open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    navigation.classList.toggle('is-open', open);
  });
  navigation.addEventListener('click', function (event) {
    if (event.target && event.target.closest('a')) {
      button.setAttribute('aria-expanded', 'false');
      navigation.classList.remove('is-open');
    }
  });
})();
