import { getNavInfo } from "../../utils/nav";
Page({ data:{ statusBarHeight:20,navBarHeight:44,navRightPadding:96,type:"privacy" }, onLoad(options:Record<string,string>){const nav=getNavInfo();this.setData({statusBarHeight:nav.statusBarHeight,navBarHeight:nav.navBarHeight,navRightPadding:nav.navRightPadding,type:options.type==="terms"?"terms":"privacy"});},onBack(){wx.navigateBack();} });
