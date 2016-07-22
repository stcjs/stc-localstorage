todo

### DEMO

```js
var localstorage = require('stc-localstorage');

// var localstorageAdapter = require('stc-localstorage-smarty');
// var localstorageAdapter = require('stc-localstorage-php');
// var localstorageAdapter = require('stc-localstorage-ejs');
var localstorageAdapter = require('stc-localstorage-nunjucks');

stc.config({
  workers: 4,
  cluster: false,
  cache: false,
  include: ['template/', 'resource/'],
  tpl: {
    engine: 'nunjucks',
    extname: 'nunjucks',
    ld: ['{%', '{{'],
    rd: ['%}', '}}'],
  }
});

stc.workflow({
  Localstorage: {
    plugin: localstorage,
    include: /\.tpl$/,
    options: {
      adapter: localstorageAdapter,
      minLength : 200,
      appId : 'd8e8fca2'
    }
  },
});

stc.start();
```