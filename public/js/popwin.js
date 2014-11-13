String.prototype.startWith=function(str) {
    var reg=new RegExp("^"+str);
    return reg.test(this);
}

var user = detect.parse(navigator.userAgent);
var browserName = user.browser.family;
var browserVersion = user.browser.version;
$(document).ready(function() {
    if (browserName.startWith("IE") && browserVersion < 10) {
        document.write("<div style='position:fixed; top:50px; width:100%; height:40px; line-height:40px; z-index:9999; background:#FFFF99; text-align:center;'>注意：本站暂不支持IE10以下的浏览器，您可以选择安装<a href='http://w.x.baidu.com/alading/anquan_soft_down_ub/14744' target='_blank'>chrome浏览器</a>或者<a href='http://jingyan.baidu.com/article/335530da411e4219cb41c304.html' target='_blank'>升级IE</a>至10以上版本</div>");
    }
    if (user.os.name.startWith('iOS') || user.os.name.startWith('Android')) {
        $("#moquu_wxin").css('display','none');
        $("#moquu_wshare").css('display','none');
        $("#moquu_top").css('display','none');
    } else {
        $("#moquu_qrcode").css('display','none');
    }
    $("#moquu_top").click(function() {
        $(document).scrollTop(0);
    });
});
