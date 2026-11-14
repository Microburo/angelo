// Registers (on) or unregisters (off) font files with Core Text, persistent scope:
// the system holds the activation, Figma sees it without a restart, nothing is copied.
// Usage: angelo-fonts on|off <file>...
import CoreText
import Foundation

let args = CommandLine.arguments
guard args.count >= 3, args[1] == "on" || args[1] == "off" else {
  FileHandle.standardError.write("usage: angelo-fonts on|off <file>...\n".data(using: .utf8)!)
  exit(2)
}
let urls = args.dropFirst(2).map { URL(fileURLWithPath: $0) } as CFArray
let done = DispatchSemaphore(value: 0)
var failed: [String] = []

let handler: (CFArray, Bool) -> Bool = { errors, finished in
  for e in errors as! [CFError] {
    let info = CFErrorCopyUserInfo(e) as? [String: Any] ?? [:]
    let code = CFErrorGetCode(e)
    // already (un)registered is not a failure
    if code == CTFontManagerError.alreadyRegistered.rawValue || code == CTFontManagerError.notRegistered.rawValue { continue }
    let bad = (info[kCTFontManagerErrorFontURLsKey as String] as? [URL])?.map(\.path) ?? []
    failed.append("\(code) \(bad.joined(separator: ", "))")
  }
  if finished { done.signal() }
  return true
}

if args[1] == "on" {
  CTFontManagerRegisterFontURLs(urls, .persistent, true, handler)
} else {
  CTFontManagerUnregisterFontURLs(urls, .persistent, handler)
}
done.wait()
for f in failed { print("error \(f)") }
exit(failed.isEmpty ? 0 : 1)
