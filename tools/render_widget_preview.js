const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
fs.mkdirSync('tmp/widget-preview',{recursive:true});
let source=fs.readFileSync('ios/Blank/Blank/BlankWidgetSurface.swift','utf8')
    .replace('import SwiftUI','import SwiftUI\nimport AppKit')
    .replace('Image("MinimalAtmosphere")','Image(nsImage: NSImage(contentsOfFile: CommandLine.arguments[1])!)')
    .replace('Text(timerInterval: date...max(date, deadline), countsDown: true)','Text("00:42")');
fs.writeFileSync('tmp/widget-preview/Surface.swift',source);
for(const [cmd,args] of [
    ['swiftc',['-swift-version','5','-parse-as-library','tmp/widget-preview/Surface.swift','tools/render_widget_preview.swift','-o','tmp/widget-preview/render']],
    ['tmp/widget-preview/render',['ios/Blank/Blank/Assets.xcassets/MinimalAtmosphere.imageset/atmosphere.png','ios/Blank/Blank/Fonts/neue-montreal-regular.otf','tmp/widget-preview']]
]) {const r=spawnSync(cmd,args,{encoding:'utf8'});if(r.error||r.status!==0)throw Error(r.error?.message||r.stderr);}
console.log('Production widget surface rendered at 158pt @3x: idle, active, cooldown and hard protection');
