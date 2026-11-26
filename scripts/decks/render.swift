// render.swift <pdf> <outdir> <width>: every page as outdir/NNN.png
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count == 4, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])), let width = Double(args[3]) else {
	fputs("usage: render.swift <pdf> <outdir> <width>\n", stderr); exit(1)
}
let out = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
for i in 0..<doc.pageCount {
	guard let page = doc.page(at: i) else { continue }
	let box = page.bounds(for: .mediaBox)
	let scale = width / box.width
	let w = Int(width.rounded()), h = Int((box.height * scale).rounded())
	guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
		samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
		let ctx = NSGraphicsContext(bitmapImageRep: rep) else { continue }
	let cg = ctx.cgContext
	cg.setFillColor(NSColor.white.cgColor)
	cg.fill(CGRect(x: 0, y: 0, width: w, height: h))
	cg.scaleBy(x: scale, y: scale)
	cg.translateBy(x: -box.minX, y: -box.minY)
	page.draw(with: .mediaBox, to: cg)
	let png = rep.representation(using: .png, properties: [:])!
	try! png.write(to: out.appendingPathComponent(String(format: "%03d.png", i + 1)))
}
print("\(doc.pageCount) pages")
