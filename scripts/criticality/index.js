// only ES5 is allowed in this file
require('babel-register')({
  presets: [ 'es2015' ],
  plugins: [ 'transform-regenerator', 'syntax-async-functions' ]
});

require('babel-polyfill');

// load the server
require('./criticality.js');
