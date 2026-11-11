// Renders the Topoi wordmark assets from the Inter variable font: the 1024 app icon (black field, white wordmark) and the transparent wordmark images the LaunchScreen storyboard scales to width.
// Usage: swift scripts/make-logo.swift <inter-variable.ttf> <out-dir>

import AppKit
import CoreText
import Foundation

let args = CommandLine.arguments
precondition(args.count == 3, "usage: make-logo.swift <inter-variable.ttf> <out-dir>")
let fontPath = args[1]
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

// Register the variable font for this process, then pin the wght axis at 800 (ExtraBold).
var registerError: Unmanaged<CFError>?
CTFontManagerRegisterFontsForURL(URL(fileURLWithPath: fontPath) as CFURL, .process, &registerError)
if let registerError { FileHandle.standardError.write("register: \(registerError.takeRetainedValue())\n".data(using: .utf8)!) }

let wght = 0x77676874 as UInt32 // 'wght'
let descriptor = CTFontDescriptorCreateWithAttributes([
  kCTFontNameAttribute: "Inter" as CFString,
  kCTFontVariationAttribute: [NSNumber(value: wght): NSNumber(value: 800.0)] as CFDictionary
] as CFDictionary)

func font(size: CGFloat) -> CTFont { CTFontCreateWithFontDescriptor(descriptor, size, nil) }

let probe = font(size: 100)
print("font: \(CTFontCopyPostScriptName(probe)) family: \(CTFontCopyFamilyName(probe))")
if let variation = CTFontCopyVariation(probe) as? [NSNumber: NSNumber] {
  print("variation: \(variation)")
}

let text = "Topoi."
let attributes: [NSAttributedString.Key: Any] = [
  NSAttributedString.Key(kCTFontAttributeName as String): probe,
  NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 1, green: 1, blue: 1, alpha: 1)
]
func line(size: CGFloat) -> CTLine {
  var attrs = attributes
  attrs[NSAttributedString.Key(kCTFontAttributeName as String)] = font(size: size)
  return CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
}

let probeInk = CTLineGetImageBounds(line(size: 100), nil)
print("probe ink at 100pt: \(probeInk)")
let aspect = probeInk.height / probeInk.width
print(String(format: "ink aspect (height/width): %.6f", aspect))

/// The wordmark as a transparent bitmap whose bounds are the glyph ink plus a 2px bleed for antialiasing.
func wordmark(inkWidth: CGFloat) -> CGImage {
  let size = 100 * inkWidth / probeInk.width
  let ctLine = line(size: size)
  let ink = CTLineGetImageBounds(ctLine, nil)
  let bleed: CGFloat = 2
  let width = Int(ceil(ink.width + bleed * 2))
  let height = Int(ceil(ink.height + bleed * 2))
  let space = CGColorSpaceCreateDeviceRGB()
  let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.setShouldAntialias(true)
  context.setAllowsAntialiasing(true)
  context.textMatrix = .identity
  context.textPosition = CGPoint(x: bleed - ink.origin.x, y: bleed - ink.origin.y)
  CTLineDraw(ctLine, context)
  return context.makeImage()!
}

func write(_ image: CGImage, _ name: String) {
  let url = outDir.appendingPathComponent(name)
  let rep = NSBitmapImageRep(cgImage: image)
  let data = rep.representation(using: .png, properties: [:])!
  try! data.write(to: url)
  print("wrote \(url.lastPathComponent) \(image.width)x\(image.height)")
}

// The wordmark images the launch screen scales: 1x/2x/3x of one point size.
for (scale, width) in [(1, 400), (2, 800), (3, 1200)] {
  let mark = wordmark(inkWidth: CGFloat(width))
  write(mark, scale == 1 ? "wordmark.png" : "wordmark@\(scale)x.png")
}

// The app icon: a 1024 black square with the wordmark at 84% of its width, optically centered on its ink.
let canvas = 1024
let iconInk = CGFloat(canvas) * 0.84
let mark = wordmark(inkWidth: iconInk)
let space = CGColorSpaceCreateDeviceRGB()
let icon = CGContext(data: nil, width: canvas, height: canvas, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
icon.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
icon.fill(CGRect(x: 0, y: 0, width: canvas, height: canvas))
let x = (CGFloat(canvas) - CGFloat(mark.width)) / 2
let y = (CGFloat(canvas) - CGFloat(mark.height)) / 2
icon.draw(mark, in: CGRect(x: x.rounded(), y: y.rounded(), width: CGFloat(mark.width), height: CGFloat(mark.height)))
write(icon.makeImage()!, "AppIcon-512@2x.png")
