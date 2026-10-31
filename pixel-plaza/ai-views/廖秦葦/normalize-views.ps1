param([string]$Manifest)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public class SpriteCanvas {
 public static string Save(string source,string dest) {
  using(var src=new Bitmap(source)) {
   int l=src.Width,t=src.Height,r=-1,b=-1;
   for(int y=0;y<src.Height;y++) for(int x=0;x<src.Width;x++) if(src.GetPixel(x,y).A>16) {l=Math.Min(l,x);r=Math.Max(r,x);t=Math.Min(t,y);b=Math.Max(b,y);}
   if(r<l) throw new Exception("Empty image");
   float scale=Math.Min(410f/(b-t+1),380f/(r-l+1));
   float w=(r-l+1)*scale,h=(b-t+1)*scale;
   using(var dst=new Bitmap(402,478,PixelFormat.Format32bppArgb)) {
    using(var g=Graphics.FromImage(dst)) {
     g.Clear(Color.Transparent);g.InterpolationMode=InterpolationMode.HighQualityBicubic;
     g.DrawImage(src,new RectangleF((402-w)/2,469-h,w,h),new RectangleF(l,t,r-l+1,b-t+1),GraphicsUnit.Pixel);
    }
    dst.Save(dest,ImageFormat.Png);
   }
   return dest+" 402x478 RGBA";
  }
 }
}
'@
$items=Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
foreach($item in $items) { [SpriteCanvas]::Save($item.source,(Join-Path $PWD $item.name)) }
