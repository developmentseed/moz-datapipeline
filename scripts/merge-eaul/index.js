require('babel-register')({
  presets: [ 'es2015' ],
  plugins: [ 'transform-regenerator', 'syntax-async-functions' ],
  'sourceMaps': 'inline',
  'retainLines': true
});

require('babel-polyfill');

// load the server
require('./eaul.js');
