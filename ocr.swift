// Prints the text macOS Vision finds in an image as JSON:
// [{"text": ..., "conf": ..., "x": ..., "y": ..., "w": ..., "h": ...}], pixel coords, origin top-left.
// Usage: swift ocr.swift image.jpg
import Foundation
import Vision
import AppKit

let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("cannot read \(path)\n".data(using: .utf8)!)
    exit(1)
}
let W = Double(cg.width), H = Double(cg.height)

let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
req.automaticallyDetectsLanguage = true

try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])

var out: [[String: Any]] = []
for obs in req.results ?? [] {
    guard let c = obs.topCandidates(1).first else { continue }
    let b = obs.boundingBox
    out.append([
        "text": c.string, "conf": c.confidence,
        "x": Int(b.minX * W), "y": Int((1 - b.maxY) * H),
        "w": Int(b.width * W), "h": Int(b.height * H),
    ])
}
let data = try JSONSerialization.data(withJSONObject: out, options: [])
print(String(data: data, encoding: .utf8)!)
