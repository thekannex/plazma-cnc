# Plasma Kontrol logo isleme: koyu arka plani seffaflastir, kirp, simge (ico) uret.
# Kullanim: powershell -ExecutionPolicy Bypass -File build\brand\logo-isle.ps1
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $dir '..\..')

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.IO;
using System.Collections.Generic;

public static class LogoTool {
    // Arka plan rengine uzakliga gore alfa; kenarlarda arka plan karisimini geri al
    public static Bitmap KeyOut(Bitmap src, float t0, float t1) {
        int w = src.Width, h = src.Height;
        Bitmap s = new Bitmap(src);
        // Arka plan: dort kosenin ortalamasi
        Color[] cs = { s.GetPixel(2,2), s.GetPixel(w-3,2), s.GetPixel(2,h-3), s.GetPixel(w-3,h-3) };
        float br=0,bg=0,bb=0; foreach (var c in cs) { br+=c.R; bg+=c.G; bb+=c.B; } br/=4; bg/=4; bb/=4;
        Bitmap o = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            Color c = s.GetPixel(x, y);
            float d = (float)Math.Sqrt((c.R-br)*(c.R-br) + (c.G-bg)*(c.G-bg) + (c.B-bb)*(c.B-bb));
            float a = Math.Max(0f, Math.Min(1f, (d - t0) / (t1 - t0)));
            if (a <= 0) { o.SetPixel(x, y, Color.Transparent); continue; }
            int r = Clamp((c.R - br * (1 - a)) / a), g = Clamp((c.G - bg * (1 - a)) / a), b = Clamp((c.B - bb * (1 - a)) / a);
            o.SetPixel(x, y, Color.FromArgb((int)(a * 255), r, g, b));
        }
        s.Dispose();
        return o;
    }
    static int Clamp(float v) { return (int)Math.Max(0, Math.Min(255, Math.Round(v))); }

    // Alfa > esik olan alanin sinirlari (x0..x1 araliginda)
    public static Rectangle Bounds(Bitmap b, int x0, int x1, int thr) {
        int minX = int.MaxValue, minY = int.MaxValue, maxX = -1, maxY = -1;
        for (int y = 0; y < b.Height; y++) for (int x = x0; x < x1; x++) {
            if (b.GetPixel(x, y).A > thr) { if (x<minX) minX=x; if (x>maxX) maxX=x; if (y<minY) minY=y; if (y>maxY) maxY=y; }
        }
        return Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
    }

    public static Bitmap Crop(Bitmap b, Rectangle r, int pad) {
        Rectangle rr = Rectangle.FromLTRB(Math.Max(0, r.Left - pad), Math.Max(0, r.Top - pad), Math.Min(b.Width, r.Right + pad), Math.Min(b.Height, r.Bottom + pad));
        return b.Clone(rr, PixelFormat.Format32bppArgb);
    }

    // Kare tuvale ortala ve boyutlandir
    public static Bitmap Square(Bitmap b, int size) {
        Bitmap o = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(o)) {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.SmoothingMode = SmoothingMode.HighQuality;
            float sc = Math.Min((float)size / b.Width, (float)size / b.Height);
            float w = b.Width * sc, h = b.Height * sc;
            g.DrawImage(b, (size - w) / 2, (size - h) / 2, w, h);
        }
        return o;
    }

    // PNG gomulu cok boyutlu ICO
    public static void WriteIco(Bitmap src, int[] sizes, string path) {
        List<byte[]> imgs = new List<byte[]>();
        foreach (int s in sizes) { using (Bitmap b = Square(src, s)) using (MemoryStream ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); imgs.Add(ms.ToArray()); } }
        using (FileStream fs = new FileStream(path, FileMode.Create)) using (BinaryWriter w = new BinaryWriter(fs)) {
            w.Write((short)0); w.Write((short)1); w.Write((short)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int i = 0; i < sizes.Length; i++) {
                int s = sizes[i];
                w.Write((byte)(s >= 256 ? 0 : s)); w.Write((byte)(s >= 256 ? 0 : s)); w.Write((byte)0); w.Write((byte)0);
                w.Write((short)1); w.Write((short)32); w.Write(imgs[i].Length); w.Write(offset);
                offset += imgs[i].Length;
            }
            foreach (var d in imgs) w.Write(d);
        }
    }
}
"@

$src = [System.Drawing.Bitmap]::FromFile((Join-Path $dir 'logo-kaynak.png'))
$keyed = [LogoTool]::KeyOut($src, 18, 70)
$src.Dispose()

# Tam logo (simge + yazi), seffaf, kirpilmis
$all = [LogoTool]::Bounds($keyed, 0, $keyed.Width, 20)
$logo = [LogoTool]::Crop($keyed, $all, 6)
$logo.Save((Join-Path $dir 'logo-seffaf.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# Simge: sadece soldaki "P" isareti (yazidan once gelen kisim)
$markRegion = [LogoTool]::Bounds($keyed, 0, [int]($keyed.Width * 0.29), 20)
$mark = [LogoTool]::Crop($keyed, $markRegion, 4)
$mark.Save((Join-Path $dir 'simge-seffaf.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# Uygulamanin kullandigi dosyalar
$logo.Save((Join-Path $root 'app\img\plasma-logo.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$logo.Save((Join-Path $root 'cam\images\plasma-logo.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$sq256 = [LogoTool]::Square($mark, 256); $sq256.Save((Join-Path $root 'build\icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$sq512 = [LogoTool]::Square($mark, 512); $sq512.Save((Join-Path $root 'app\icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$sq32 = [LogoTool]::Square($mark, 32); $sq32.Save((Join-Path $root 'build\32x32.png'), [System.Drawing.Imaging.ImageFormat]::Png)
[LogoTool]::WriteIco($mark, @(16, 24, 32, 48, 64, 128, 256), (Join-Path $root 'build\icon.ico'))
[LogoTool]::WriteIco($mark, @(16, 32, 48), (Join-Path $root 'build\favicon.ico'))
[LogoTool]::WriteIco($mark, @(16, 32, 48), (Join-Path $root 'app\favicon.ico'))

"logo: {0}x{1}  simge: {2}x{3}" -f $logo.Width, $logo.Height, $mark.Width, $mark.Height

# Pencere simgesi (app/favicon.png) icin build/icon.png kopyalanir
Copy-Item (Join-Path $root 'build\icon.png') (Join-Path $root 'app\favicon.png') -Force
