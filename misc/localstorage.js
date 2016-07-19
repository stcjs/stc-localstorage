// 内联文件存储到localStorage 由燕尾服在编译期注入模板，不直接引用 更新需要联系李成银部署
// 使用方式 :
// 1.config.php中加入 'MOD_INLINE_TO_LS' =>  true 打开开关

// 2 页面顶部加入{%lscookie='mso_home'%} lscookie不能为其它名字
// <style data-ls="id">
// <script data-ls="id">xxx</script>
// <link rel="stylesheet" inline data-ls="id">
// <script src="xxx" data-ls="id"></script>
// data-ls不能重复，不能出现[-./]等非法字符
// 对外抛出的三个接口名字不可以修改
// 不可以缓存长度短于100字符的代码，会造成无限刷新
;(function(window, document) {
    // 'use strict';
    function $(id) {
        return document.getElementById(id);
    }

    function markNotLocalStorage() {
        setCookie('stc_nls', 1, 1);
    }

    function getLs(key, cookieName) {
        var value = '';
        try{
            value = _localStorage[key] || '';
            if(value.length < 99) {
                setCookie(cookieName, 0);
                document.documentElement.style.display = 'none';
                clearStcCookie();
                window.onbeforeunload = null;
                location.reload(true);
            }
        }catch(e){
            clearStcCookie();
        }
        return value;
    }

    function setLs(key, value) {
        try { // 还是有可能存入错误
            _localStorage[key] = value;
            if(value !== _localStorage[key] ) {
                clearStcCookie();
            }
        } catch(e) {
            clearStcCookie();
        }
    }

    function getCookie(name){
        var cookies = document.cookie.split('; ');
        for(var i = 0,length = cookies.length, item; i< length; i++){
            item = cookies[i].split('=');
            if(item[0] === name){
                return item[1];
            }
        }
        return '';
    }

    function setCookie(name, value, expires) {
        expires = expires || 60;
        if(!value) {
            expires = -1;
        }
        expires = new Date(+new Date() + expires * 86400000).toGMTString();
        var cookie = name + '=' + value + '; path=/; expires=' + expires;
        if(location.protocol.indexOf('https') > -1){
        	cookie += '; Secure';
        }
        document.cookie = cookie;
    }

    function html2ls(lsName, id) {
        var htmlString = $(id) && $(id).innerHTML.trim();
        setLs(lsName, htmlString);
    }

    function ls2html(lsName, tagName, cookieName) {
        var htmlString = getLs(lsName, cookieName);
        var tag = document.createElement(tagName);
        tag.innerHTML = htmlString;
        document.head.appendChild(tag);
    }
    function clearStcCookie() {
        var stcReg       = /(?:;)?stc_[^=]*=[^;]*;?/g,
            stcCookieArr = document.cookie.match(stcReg) || [],
            i            = stcCookieArr.length;
        while (i) {
            --i;
            setCookie(stcCookieArr[i].split('=')[0], 0);
        }
    }
    function updateVersion(name, key, version){
        var cookie = getCookie(name).split('');
        var flag = false;
        for(var i = 0, length = cookie.length; i < length; i += 2){
            if(cookie[i] === key){
                cookie[i + 1] = version;
                flag = true;
                break;
            }
        }
        if(!flag){
            cookie.push(key, version);
        }
        setCookie(name, cookie.join(''));
    }

    var noop = function() {};
    var _localStorage;
    var supportLocalStorage = 0;
    var LS = window.LS = {
        html2ls   : noop,
        ls2html   : noop,
        //setCookie : noop,
        updateVersion: noop
    };

    try{
        _localStorage = localStorage;
        LS.html2ls    = html2ls;
        LS.ls2html    = ls2html;
        //LS.setCookie  = setCookie;
        LS.updateVersion = updateVersion;
    } catch(e){
        markNotLocalStorage();
    }
})(this, document);
