(function(e,t){function n(e){return t.getElementById(e)}function r(){u("stc_nls",1,1)}function i(n,r){var i="";try{i=d[n]||"",i.length<99&&(u(r,0),t.documentElement.style.display="none",c(),e.onbeforeunload=null,location.reload(!0))}catch(s){c()}return i}function s(e,t){try{d[e]=t,t!==d[e]&&c()}catch(n){c()}}function o(e){var n=t.cookie.split("; ");for(var r=0,i=n.length,s;r<i;r++){s=n[r].split("=");if(s[0]===e)return s[1]}return""}function u(e,n,r){r=r||60,n||(r=-1),r=(new Date(+(new Date)+r*864e5)).toGMTString();var i=e+"="+n+"; path=/; expires="+r;location.protocol.indexOf("https")>-1&&(i+="; Secure"),t.cookie=i}function a(e,t){var r=n(t)&&n(t).innerHTML.trim();s(e,r)}function f(n,r,s){var o=i(n,s);if(e.execScript&&r==="script")return e.execScript(o);var u=t.createElement(r);u.innerHTML=o,t.head.appendChild(u)}function c(){l=!0;var e=/(?:;)?stc_[^=]*=[^;]*;?/g,n=t.cookie.match(e)||[],r=n.length;while(r)--r,u(n[r].split("=")[0],0)}function h(e,t,n){if(l)return;var r=o(e).split(""),i=!1;for(var s=0,a=r.length;s<a;s+=2)if(r[s]===t){r[s+1]=n,i=!0;break}i||r.push(t,n),u(e,r.join(""))}var l=!1,p=function(){},d,v=0,m=e.LS={html2ls:p,ls2html:p,updateVersion:p};try{d=localStorage,m.html2ls=a,m.ls2html=f,m.updateVersion=h}catch(g){r()}})(this,document);