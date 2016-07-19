import Plugin from 'stc-plugin';
import {extend, promisify, isRemoteUrl} from 'stc-helper';
import fs from 'fs';
import uglify from 'stc-uglify';
import {resolve} from 'url';

const RegInCss = [{
    // background image
    regexp: /url\s*\(\s*([\'\"]?)([\w\-\/\.\@]+\.(?:png|jpg|gif|jpeg|ico|cur|webp))(?:\?[^\?\'\"\)\s]*)?\1\s*\)/i,
    index: 2
  }, {
    // font
    regexp: /url\s*\(\s*([\'\"]?)([^\'\"\?]+\.(?:eot|woff|woff2|ttf|svg))([^\s\)\'\"]*)\1\s*\)/ig,
    index: 2
  }, {
    // ie filter
    regexp: /src\s*=\s*([\'\"])?([^\'\"]+\.(?:png|jpg|gif|jpeg|ico|cur|webp))(?:\?[^\?\'\"\)\s]*)?\1\s*/i,
    index: 2
  }
];

const HomePath = process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];

export default class LocalstoragePlugin extends Plugin {
  /**
   * run
   */
  async run() {
    let content = await this.getContent('utf-8');

    //不包含特征的文件，直接忽略
    if(!['data-ls', 'lscookie'].some(s => content.indexOf(s) > -1)) {
      return;
    }

    let newTokens = [];

    let tokens = await this.getAst();
    let lsFlagToken = await this.getlsFlagToken();

    let findLSFlag = false;

    for(let token of tokens) {
      let tokenType = token.type;

      //找到了 LS 占位符
      if(tokenType === this.TokenType.TPL && '$lscookie' == token.ext.value) {
        newTokens.push(lsFlagToken);
        findLSFlag = true;
        
        continue;
      }
      
      //找到外链
      if(tokenType === this.TokenType.HTML_TAG_SCRIPT || (tokenType === this.TokenType.HTML_TAG_START && token.ext.tag == 'link')) {
        let attrs = this.getAttrs(tokenType, token);

        //在外链标签上找到了 data-ls 标记
        if(this.hasLsAttr(tokenType, attrs)) {

          //data-ls 属性必须用在 LS 占位符之后
          if(!findLSFlag) {
            this.fatal(`localStorage cookie name must be set before style or script`, token.loc.start.line, token.loc.start.column);
            return [];
          }

          let tokens;

          if(tokenType === this.TokenType.HTML_TAG_SCRIPT) {
            tokens = await this.getScriptTagTokens(token, attrs);
          } else {
            tokens = await this.getLinkTagTokens(token, attrs);
          }

          [].push.apply(newTokens, tokens);

          continue;
        }
      }
      //其它情况
      newTokens.push(token);
    }

    return newTokens;
  }

  //生成替换 link 代码的 token
  async getLinkTagTokens(token, attrs) {
    let href = this.stc.flkit.getHtmlAttrValue(attrs, 'href');
    
    //远程地址不处理
    if(isRemoteUrl(href)) {
      token.ext.attrs = token.ext.attrs.filter(attr => attr.name !== 'data-ls');
      return [token];
    }

    let tokens = await (this.getFileByPath(href)).getAst();
    
    return this.resolvePathInCss(href, tokens);
  }

  //处理 css 中引用资源的路径
  resolvePathInCss(cssPath, tokens) {
    let newTokens = [];

    tokens.forEach(token => {
      // css value
      if(token.type === this.TokenType.CSS_VALUE){
        RegInCss.some(item => {
          let flag = false;

          token.ext.value.replace(item.regexp, (...args) => {
            let resPath = args[item.index];

            // only resolve relative path
            if(resPath && !isRemoteUrl(resPath) && /^\.{2}\//.test(resPath)) {
              flag = true;

              let resolvedResPath = resolve(cssPath, resPath);

              token = extend({}, token);
              token.value = token.value.replace(resPath, resolvedResPath);
              token.ext.value = token.value;
            }

            return flag;
          });
        });
      }

      newTokens.push(token);
    });

    return newTokens;
  }

  //生成替换 script 代码的 token
  async getScriptTagTokens(token, attrs) {
    return [];
  }

  //生成替换占位符对应代码的 token
  async getlsFlagToken() {
    let content;

    let cachedContent = await this.cache('localstorage_js');
    //console.log(cachedContent);

    if(cachedContent) {
      content = cachedContent;
    } else {
      let readFile = promisify(fs.readFile, fs);

      let fileContent = (await readFile(`${__dirname}/../misc/localstorage.js`)).toString('utf-8');
      let fileName = '/stc/stc-localstorage/localstorage.js';
      let file = await this.addFile(fileName, fileContent, true);
      let compressRet = await this.invokePlugin(uglify, file);
      content = compressRet.content;

      await this.cache('localstorage_js', () => {
        return content;
      });
    }

    let token = this.createRawToken(this.TokenType.HTML_TAG_SCRIPT, content);

    return token;
  }

  //获取一个 token 的所有 attr
  getAttrs(tokenType, token) {
    let attrs = [];

    //处理 Link
    if(tokenType == this.TokenType.HTML_TAG_START) {
      attrs = token.ext.attrs;
    } 
    //处理 Script
    else if(tokenType == this.TokenType.HTML_TAG_SCRIPT) {
      attrs = token.ext.start.ext.attrs;
    }

    return attrs;
  }

  //判断 attr 中是否存在 data-ls
  hasLsAttr(tokenType, attrs) {
    //处理 Link
    if(tokenType == this.TokenType.HTML_TAG_START) {
      //不是 CSS，直接返回
      if(this.stc.flkit.getHtmlAttrValue(attrs, 'rel') !== 'stylesheet') {
        return false;
      }

      //没有 data-ls 属性，直接返回
      if(!this.stc.flkit.getHtmlAttrValue(attrs, 'data-ls')) {
        return false;
      }

      //没有 href 属性，直接返回
      if(!this.stc.flkit.getHtmlAttrValue(attrs, 'href')) {
        return false;
      }

      return true;
    } 
    //处理 Script
    else if(tokenType == this.TokenType.HTML_TAG_SCRIPT) {
      //没有 data-ls 属性，直接返回
      if(!this.stc.flkit.getHtmlAttrValue(attrs, 'data-ls')) {
        return false;
      }

      //没有 src 属性，直接返回
      if(!this.stc.flkit.getHtmlAttrValue(attrs, 'src')) {
        return false;
      }

      return true;
    }

    return false;
  }

  update(tokens) {
    this.setAst(tokens);

    return tokens;
  }

  static after() {
    console.log('all done.');
  }

  static cluster() {
    return false;
  }

  static cache() {
    return true;
  }

}
