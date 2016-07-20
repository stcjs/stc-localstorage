import Plugin from 'stc-plugin';

import {
  extend, 
  promisify, 
  isRemoteUrl, 
  isFile, 
  isDirectory, 
  mkdir,
  md5,
} from 'stc-helper';

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

//默认配置项
const DefaultOpt = {
  minLength     : 1000,                //存到 LS 中的文件允许的最小字符数
  nlsCookie     : 'stc_nls',           //不支持 LS 时，记录的 cookie name
  lsCookie      : 'stc_ls',
  htmlToLs      : 'LS.html2ls', 
  lsToHtml      : 'LS.ls2html', 
  updateVersion : 'LS.updateVersion',
};

const LsConfigKey = '--stc-ls-config-key--';

const KeyList = 'RzS!T(U_V~W0X2Y4Z6a8bAcCdEeGfIgKhMiOjQk)l-m3n7oBpFqJrNs*t1u9HyxwvLD5.P'.split('');

//localstorage 基础 JS 的路径
const LsJsPath = `${__dirname}/../misc`;

//localstorage 基础 JS 代码
let LsJsCode = '';

//Adapter 实例
let Adapter = null;

//APP Config 的路径
const AppConfigPath = `${__dirname}/../tmp`;

//APP 的 LS 配置
let AppConfig = null;

//已经处理过的 data-ls 属性
let LsNames = {};

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

    //mix 默认配置
    this.options = extend(DefaultOpt, this.options);

    //APP ID 校验
    let appId = this.options.appId;
    if(!appId) {
      this.fatal(`options.appId must be set`);
      return;
    }

    //如果没有初始化过，就执行初始化
    if(!AppConfig) {
      //读取 APP Config
      await this.getAppConfig();

      //Adapter
      let adapter = this.options.adapter;

      if(adapter && typeof adapter.default === 'function'){
        adapter = adapter.default;
      }

      if(typeof adapter !== 'function'){
        this.fatal(`options.adapter must be a function`);
        return;
      }
      
      Adapter = new adapter(this.options, this.config);

      //localstorage 基础 JS 代码
      LsJsCode = await this.readFile(`${LsJsPath}/localstorage.js`);
    }

    let oldTokens = await this.getAst();
    let newTokens = [];
    let findLSFlag = false;

    for(let token of oldTokens) {
      let tokenType = token.type;

      //找到了 LS 占位符
      if(tokenType === this.TokenType.TPL && '$lscookie' == token.ext.value) {
        findLSFlag = true;
        
        let tokens = await this.getlsFlagTokens();
        [].push.apply(newTokens, tokens);
        
        continue;
      }
      
      //找到外链标签
      if(tokenType === this.TokenType.HTML_TAG_SCRIPT || (tokenType === this.TokenType.HTML_TAG_START && token.ext.tag == 'link')) {
        let attrs = this.getAttrs(tokenType, token);

        //在外链标签上找到了 data-ls 标记
        if(this.hasLsAttr(tokenType, attrs)) {
          //data-ls 属性必须用在 LS 占位符之后
          if(!findLSFlag) {
            this.fatal(`localStorage cookie name must be set before style or script`, token.loc.start.line, token.loc.start.column);
            return [];
          }

          let tokens = await this.getLsTagTokens(tokenType, token, attrs);
          [].push.apply(newTokens, tokens);

          continue;
        }
      }

      //其它情况
      newTokens.push(token);
    }

    return newTokens;
  }

  //根据含有 data-ls 属性的 token 生成新的 token lists
  async getLsTagTokens(tokenType, token, attrs) {
    let isScript = tokenType === this.TokenType.HTML_TAG_SCRIPT;

    let lsName = this.stc.flkit.getHtmlAttrValue(attrs, 'data-ls');

    //data-ls 值的合法性校验
    if(!/^\w+$/.test(lsName)) {
      this.fatal(`data-ls="${lsName}" is not valid`, token.loc.start.line, token.loc.start.column);
      return [];
    }

    let source = this.stc.flkit.getHtmlAttrValue(attrs, isScript ? 'src' : 'href');

    //远程地址移除 data-ls 后原样输出
    if(isRemoteUrl(source)) {
      this.removeLsAttr(tokenType, token);
      return [token];
    }

    let file = this.getFileByPath(source);

    //最小字符串判断
    let content = await file.getContent('utf-8');
    if(content.length < this.options.minLength) {
      this.fatal(`data-ls="${lsName}" content length less than ${this.options.minLength} in file`, token.loc.start.line, token.loc.start.column);
      return [];
    }

    //data-ls 属性值冲突判断
    if(!LsNames[lsName]) {
      LsNames[lsName] = [];
    } else if(LsNames[lsName].indexOf(source) === -1) {
      //如果不是之前出现的值，就报错
      this.fatal(`data-ls="${lsName}" is conflict, ${source}, ${LsNames[lsName].join(',')}`, token.loc.start.line, token.loc.start.column);
      return [];
    }
    LsNames[lsName].push(source);

    let stcLsName = `stc_${lsName}`;

    let newTokens = [];
    let i = 0;

    let sourceFile = this.getFileByPath(source);
    let sourceContent;

    if(isScript) {
      sourceContent = await sourceFile.getContent('utf-8');
    } else {
      let tokens = await sourceFile.getAst();

      //resolve relative path
      tokens = this.resolvePathInCss(source, tokens);

      //tokens => content
      await sourceFile.setAst(tokens);
      sourceContent = await sourceFile.getContent('utf-8');

      //maybe has %} in css
      [[/%}/g, '%;}'], [/}}/g, '} }'], [/{#/g, '{ #']].forEach(item => {
        sourceContent = sourceContent.replace(item[0], item[1]);
      });
    }

    let sourceToken = this.createRawToken(this.TokenType[isScript ? 'HTML_TAG_SCRIPT' : 'HTML_TAG_STYLE'], sourceContent);
    sourceToken.ext.start.ext.attrs = [{name : 'id', value : stcLsName, quote : '"', nameLowerCase : 'id'}];

    let sourceMd5 = md5(sourceContent);

    //如果文件有改动，更新版本号
    this.updateLsConfigVersion(lsName, sourceMd5);
    
    let supportCode = Adapter.getLsSupportCode();
    let conditionCode = Adapter.getLsConditionCode(lsName);

    newTokens[i++] = this.createRawToken(this.TokenType.TPL, supportCode.if);
    newTokens[i++] = this.createRawToken(this.TokenType.TPL, conditionCode.if);
    newTokens[i++] = this.createRawToken(this.TokenType.HTML_TAG_SCRIPT, `${this.options.lsToHtml}("${stcLsName}","${isScript ? 'script' : 'style'}","${this.options.lsCookie}")`);
    newTokens[i++] = this.createRawToken(this.TokenType.TPL, conditionCode.else);
    newTokens[i++] = sourceToken;
    newTokens[i++] = this.createRawToken(this.TokenType.HTML_TAG_SCRIPT, `${this.options.htmlToLs}("${stcLsName}","${stcLsName}");${this.options.updateVersion}("${this.options.lsCookie}", "${conditionCode.key}", "${conditionCode.version}")`);
    newTokens[i++] = this.createRawToken(this.TokenType.TPL, conditionCode.end);
    newTokens[i++] = this.createRawToken(this.TokenType.TPL, supportCode.else);
    //不支持 LocalStorage，移除 data-ls 后原样输出
    this.removeLsAttr(tokenType, token);
    newTokens[i++] = token;
    newTokens[i++] = this.createRawToken(this.TokenType.TPL, supportCode.end);

    return newTokens;
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

  //生成替换占位符对应代码的 token
  async getlsFlagTokens() {
    let newTokens = [];
    let i = 0;

    let supportCode = Adapter.getLsSupportCode();
    let baseCode = Adapter.getLsBaseCode();
    let parseCookieCode = Adapter.getLsParseCookieCode();

    newTokens[i++] = this.createRawToken(this.TokenType.TPL, supportCode.if);
    newTokens[i++] = this.createRawToken(this.TokenType.TPL, baseCode.if);
    newTokens[i++] = this.createRawToken(this.TokenType.HTML_TAG_SCRIPT, LsJsCode);
    newTokens[i++] = this.createRawToken(this.TokenType.TPL, baseCode.end);
    newTokens[i++] = this.createRawToken(this.TokenType.TPL, parseCookieCode);
    newTokens[i++] = this.createRawToken(this.TokenType.TPL, LsConfigKey);
    newTokens[i++] = this.createRawToken(this.TokenType.TPL, supportCode.end);

    return newTokens;
  }

  //获取一个 token 的所有 attr
  getAttrs(tokenType, token) {
    let attrs = [];

    //处理 Link
    if(tokenType == this.TokenType.HTML_TAG_START) {
      attrs = token.ext.attrs;

      return attrs;
    } 

    //处理 Script
    if(tokenType == this.TokenType.HTML_TAG_SCRIPT) {
      attrs = token.ext.start.ext.attrs;

      return attrs;
    }

    return [];
  }

  removeLsAttr(tokenType, token) {
    if(tokenType == this.TokenType.HTML_TAG_START) {
      token.ext.attrs = token.ext.attrs.filter(attr => attr.name !== 'data-ls');
    } else {
      token.ext.start.ext.attrs = token.ext.start.ext.attrs.filter(attr => attr.name !== 'data-ls');
    }
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

  updateLsConfigVersion(lsName, sourceMd5) {
    let lsConfig = this.getLsConfig(lsName);

    if(!lsConfig.md5) {
      lsConfig.md5 = sourceMd5;
      return;
    }

    if(lsConfig.md5 != sourceMd5) {
      lsConfig.md5 = sourceMd5;

      let version = lsConfig.version;
      let index = KeyList.indexOf(version);

      if(index >= KeyList.length - 1) {
        index = 0;
      } else {
        index++;
      }

      let newVersion = KeyList[index];
      lsConfig.version = newVersion;
    }
  }

  getLsConfig(lsName) {
    let lsConfig = AppConfig[lsName];

    if(lsConfig) {
      lsConfig['invoked'] = true;

      return lsConfig;
    }

    let keyIndex = -1;
    for(let _ in AppConfig) {
      let config = AppConfig[_];
      let key = config.key;
      let index = KeyList.indexOf(key);

      keyIndex = Math.max(keyIndex, index);
    }

    let fileKey = ''; //新文件的 Key

    if(keyIndex == -1) {
      fileKey = KeyList[0]; //从 0 开始
    } else {
      if(keyIndex < KeyList.length - 1) { //文件还没满，则使用下一个
        fileKey = KeyList[keyIndex + 1];
      } else {
        //文件已满，则找出之前使用但现在已经不使用的 key，如果没有则报错，文件个数不能大于 64 个
        KeyList.forEach(key => {
          let flag = false;

          for(let _ in AppConfig) {
            let config = AppConfig[_];

            //表示这个 key 被用过
            if(config.key === key) {
              flag = true;
              break;
            }
          }

          if(!flag) {
            fileKey = key;
            return;
          }
        });
      }
    }

    if(!fileKey) {
      this.fatal('data-ls nums can not max than 70' );
      return {};
    }

    let data = {
      key     : fileKey,
      version : KeyList[0],
      md5     : '',
      invoked : true,
    };

    AppConfig[lsName] = data;

    return data;
  }

  async getAppConfig() {
    if(!await isDirectory(AppConfigPath)) {
      await mkdir(AppConfigPath);
    }

    let appConfigFile = `${AppConfigPath}/${this.options.appId}.json`;

    if(isFile(appConfigFile)) {
      try {
        AppConfig = JSON.parse(await this.readFile(appConfigFile));
      } catch(e) { }
    }
  }

  async readFile(path) {
      let readFile = promisify(fs.readFile, fs);
      return (await readFile(path)).toString('utf-8');
  }

  update(tokens) {
    this.setAst(tokens);

    return tokens;
  }

  //全部文件跑完之后的全局处理
  static async after(files, $this) {
    let simpleConfig = {};
    let newConfig = {};

    for(let lsName in AppConfig) {
      let config = AppConfig[lsName];
      
      if(config.invoked) {
        delete config.invoked;
        newConfig[lsName] = extend({}, config);

        delete config.md5;
        simpleConfig[lsName] = config;
      }
    }

    let configCode = Adapter.getLsConfigCode(simpleConfig);

    //替换占位符
    files.forEach(async file => {
      let fileContent = await file.getContent('utf-8');
      fileContent = fileContent.replace(new RegExp(LsConfigKey, 'g'), configCode);
      await file.setContent(fileContent);
    });

    //存储文件
    let writeFile = promisify(fs.writeFile, fs);
    let appConfigFile = `${AppConfigPath}/${$this.options.appId}.json`;

    await writeFile(appConfigFile, JSON.stringify(newConfig));
  }

  static cluster() {
    return false;
  }

  static cache() {
    return false;
  }

}
