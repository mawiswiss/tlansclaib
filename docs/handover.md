# Handover from phone to desktop

The phone app sends a recording, with the transcript and corrections made on
the phone, to tlansclaib on a computer. The computer runs the detailed
transcription, and its editor finishes the document. The handover belongs to
Free: no licence, no account, no server, and the phone app sells nothing.
Nothing is built yet. This file is the plan and what is still unknown.

## What it does

- A send goes to any computer with tlansclaib installed, the way AirDrop
  works. Nothing migrates the history between devices.
- It carries the recording and, when the phone has transcribed it, the
  phone's record: lines, title, language, model and corrections.
- It lands in the desktop history marked "From <phone>", with a notice that
  offers "Transcribe again", or "Transcribe" when no transcript came along.
  Nothing starts by itself.
- "Transcribe again" replaces the phone's lines and corrections, as the
  dialog's warning already says, and keeps the title. Today a rerun resets
  the title to the file name (`entry` in `src-tauri/src/run.rs` takes
  `file_stem`), so every rerun will carry the replaced entry's title over.
- The phone keeps its copy, marked "Sent to <computer>, <date>" once the
  desktop confirms the SHA-256 and the saved record. One tap deletes it.
- It goes one way. The desktop listens, the phone sends, and nothing syncs
  back.
- Phone and computer talk directly over the network both are on, Wi-Fi or a
  hotspot. A send over the mobile network alone is impossible without a
  server, because carriers put phones behind shared addresses that accept no
  incoming connection.

## Pairing

"Pair a phone" on the desktop shows a QR code with the desktop's static
X25519 public key, all its addresses and its port, and a 32-byte one-time
secret that is valid while the dialog is open. The phone scans it with
Tauri's official barcode-scanner plugin, and the desktop draws it with the
`qrcode` crate. A box "Remember this phone" is checked by default. Unchecked,
both sides forget the pairing after the confirmed send, so a colleague's
computer does not keep listening for someone else's phone.

The pairing handshake is Noise `XXpsk3` from the `snow` crate, with the
secret as the pre-shared key, and the desktop's key must match the one in the
QR code. Both sides then store the other's public key and a name the user can
change. Each send is Noise `IK`: the phone knows the desktop's key and sends
its own encrypted, and the desktop looks it up among its paired phones. A
computer with another key, or a phone the desktop forgot, fails the
handshake, and an onlooker cannot tell which phone connects.

Static private keys live in each app's data folder, readable by the user
only. The system key store is later hardening. Both sides list their paired
devices with "Forget", for a lost phone.

## Finding the computer

The desktop listens on TCP and advertises `_tlansclaib._tcp` by DNS-SD
whenever the app runs with a paired phone, and a switch "Receive from phones"
turns both off. It binds the port it used last and picks a new one only when
that one is taken, so saved addresses keep working. The instance name and the
host name in the SRV record are random per start and the TXT record is empty,
because the machine's real `.local` name would track the laptop across
networks.

The phone tries the instances DNS-SD finds, then the last addresses that
worked, then every address from the last QR code. Each try is an `IK`
handshake, so a wrong machine at a known address fails safely. Two devices in
the same mesh VPN, such as Tailscale, reach each other on its addresses,
which the QR code includes like any other.

A send that finds no computer waits on the phone as "Waiting for <computer>"
and goes out by itself once the computer appears while the phone app is open.
A transfer under way when the app leaves the screen finishes in iOS's
background task time (`beginBackgroundTask`).

- iOS browses with `NWBrowser` in a small Swift plugin, with
  `_tlansclaib._tcp` in `NSBonjourServices` and a
  `NSLocalNetworkUsageDescription`. Apple ties the restricted multicast
  entitlement to raw multicast and arbitrary service types, so a declared
  type through `NWBrowser` should not need it.
- Android browses with `NsdManager` in a small Kotlin plugin.
- The desktop advertises with the `mdns-sd` crate, which lets the app set the
  host name. The native DNS-SD API of Windows 10 and later is the fallback,
  but only if `mdns-sd` clashes with the system responder there and the native
  API allows a random host name.

## When the direct path fails

The app never routes around a VPN. A VPN that blocks the local network does
so on purpose, so the app names it and says what to change. Each side
reports what it can see, so a failed send names a cause instead of "not
found".

The desktop shows its own findings in the Phones dialog and the QR dialog,
and as a notice while receiving is on, because a phone that cannot reach the
desktop cannot learn them:

- A VPN carries the default route, through a `utun`, `tun`, `wg`, `ppp` or
  TAP interface: "A VPN on this computer may block phones. Allow local network
  access in it, or send while it is off."
- Windows marks the network Public, where its firewall blocks phones:
  "Windows treats this network as public. Mark it private, or use a hotspot."
- The computer has no network.

The phone diagnoses a failed send from what it sees:

| What the phone sees | Likely cause | What it says and offers |
|---|---|---|
| Not on Wi-Fi or a hotspot | No shared network | Join the computer's Wi-Fi, or the hotspot guide |
| A VPN is active (Android `TRANSPORT_VPN`, iOS from the network path) | The phone's VPN | Allow local network access in the VPN app, or pause it for the send |
| Same subnet, no DNS-SD answer, connections time out | Wi-Fi that keeps devices apart, common in guest, hotel and office networks | The hotspot guide |
| Another subnet than the computer's last address | Different networks or network parts | Join the same network, or the hotspot guide |
| No DNS-SD answer, but a known address connects | Multicast blocked | Nothing, the send goes through |

Every message also offers "Share instead" and keeps the send waiting.

## The hotspot guide

A hotspot makes a fresh network that keeps no devices apart and runs no VPN
of its own. A VPN on the computer still applies there, so the VPN advice
comes first when the desktop reports one.

- Android starts a hotspot for the transfer itself with one tap, through
  `WifiManager.startLocalOnlyHotspot`. It works without mobile signal and
  shares no internet. The system picks the name and password, which the app
  shows large, and the user joins that network on the computer. It needs
  `NEARBY_WIFI_DEVICES` from Android 13 and location before that.
- A Windows laptop starts its own Mobile hotspot from the app, sharing its
  Wi-Fi, if the system API works without admin rights. The desktop then shows
  a Wi-Fi QR code that the phone's camera joins, and the phone keeps internet
  through the laptop.
- An iPhone app can neither start Personal Hotspot nor link to its setting,
  so the guide shows the steps (Settings, Personal Hotspot, Allow Others to
  Join) and where the name and password are. A Mac on the same Apple Account
  sees the hotspot in its Wi-Fi menu without a password. Personal Hotspot
  needs mobile data on, a signal and a plan that allows it, and the guide
  warns that the computer may use mobile data for its own traffic while it is
  joined.
- An iPhone without signal and without Wi-Fi sends to a Mac by AirDrop
  through Share. Otherwise the send waits until both share a network.

## One transfer

1. The phone sends a header with the handover id, the file name, size and
   SHA-256, and the record when there is one. The record goes without its
   recording path, which holds the iOS container id or an Android
   `content://` URI, and the desktop sets its own.
2. The desktop checks a new `guard::can_receive(free_disk, recording,
   record)` and answers accept, resume from an offset, or refuse with a reason
   the phone shows, such as "Not enough disk space on <computer>".
3. The recording streams in Noise transport messages of up to 64 KB into a
   `.part` file. A broken connection keeps the `.part`, and the next attempt
   with the same handover id resumes it.
4. The desktop checks size and SHA-256, moves the file into
   `recordings/<id>/<name>` through `recordings.rs`, which then builds on the
   desktop too, and saves the record through `history.rs` with an optional
   `from` field naming the phone. It answers "saved" with the hash, and only
   then does the phone mark the recording as sent.
5. A recording the desktop already holds, by its fingerprint, lands as a new
   entry, and the notice names the earlier one. A handover never overwrites
   an existing entry.

## Share

Share hands out ordinary files that work without tlansclaib: the recording as
it is, the transcript as text, or as SRT and WebVTT on request, and "Data to
continue on the desktop", which is on when the phone has a transcript. A line
in the share sheet says the files are not encrypted and should travel a way
the user trusts. Protecting a cloud drive the user picks is not the app's
job.

The data file is `<name>.tlansclaib.json`: a format version, the recording's
file name, size and SHA-256, and the record without any path. This file will
document the format, so other tools can read it, and the desktop keeps
reading every older version.

The desktop accepts the data file by drop or "Choose a file…". It finds the
recording beside it or among the dropped files, checks size and SHA-256, and
adds a history entry marked "From <phone>". The recording stays where it is,
as with any drop. A recording dropped alone with a data file beside it offers
to continue from the phone's transcript instead of waiting for GO. Without
the recording, the desktop asks for it, as "Locate…" does today.

## Code

- `src-tauri/src/handover/` holds the protocol, pairing, frames, resume, the
  data file and the network diagnosis, as pure functions with tests. It
  builds for every target so the tests run on the desktop, with the listener
  and the advertising behind `cfg(desktop)` and sending behind `cfg(mobile)`.
- A small local Tauri plugin holds the Swift and Kotlin parts: browsing, VPN
  detection and the Android hotspot.
- The desktop window gets a Phones dialog (pair, list, forget, the receive
  switch, the network warnings), the "From <phone>" mark on history cards,
  the arrival notice and the data file import.
- The phone window gets "Send to computer" on a history entry, the list of
  computers, the scanner, the "Waiting" and "Sent" states, the diagnosis
  messages, the hotspot guide and Share.

## Wording and logs

The desktop still sends nothing anywhere, so "nothing leaves the computer" in
About stays. The phone's About says that the app runs no server, that a send
is encrypted end to end to the computer the user paired, and that Share hands
out ordinary files.

Logs hold steps, causes and byte counts, never device names, keys, addresses
or file names.

## Traps

- iOS asks for Local Network access at the first browse. Denied, discovery
  fails silently, so the phone explains and links to Settings.
- The app's own encryption changes the export compliance answer, which
  `Info.plist` gives today as `ITSAppUsesNonExemptEncryption` false. Check
  Apple's questions before the next TestFlight build.
- The macOS firewall and Windows Defender ask on the first listen. Listening
  starts in the pairing dialog, so the prompt comes when the user expects it.
- VPN detection is a guess on iOS and the desktop. A wrong guess changes the
  advice, never what the app does.
- Android is adding a local network permission. Check which version enforces
  it, and declare it.
- iOS and Android back up the phone app's `recordings/` folder unless it is
  excluded (`isExcludedFromBackup`, Android's backup and data extraction
  rules). That is a question for the phone app, separate from the handover.
- The desktop app must be running to receive, so a sleeping computer is "not
  found".

## Not known yet

A spike of about three days answers these before the protocol is built, with
a real iPhone, a real Android phone, a Mac and a Windows PC. It runs DNS-SD
and a plain 100 MB TCP transfer on home Wi-Fi, on a router's guest network
that keeps devices apart, on a network that blocks multicast, on the iPhone's
hotspot, on Android's local-only hotspot without a SIM, and with a VPN on
each side, with local access on and off. The results go into this file.

- Whether `NWBrowser` finds the computer on a real iPhone without the
  multicast entitlement.
- Whether `mdns-sd` works beside Windows' own mDNS responder.
- Whether Windows' Mobile hotspot starts from the app without admin rights.
- What each side can see of a VPN.

## Order of work

1. The spike above.
2. The protocol, about 3 days: Noise pairing and `IK`, the header, the
   chunked stream with resume, `.part` and SHA-256, `guard::can_receive`, the
   data file and the diagnosis table, tested with both ends in one process.
3. The desktop, about 3 days: listener and advertising, the Phones dialog
   with its warnings, arrivals in the history with the notice, the data file
   import.
4. The phone, about 4 days: scanner, the native plugin, the send sheet, the
   waiting queue, the sent mark, the diagnosis messages, the hotspot guide and
   Share.
5. This file rewritten to describe what was built, and a pointer in
   `docs/design.md`.

## Tests

- `cargo test --workspace`: a pairing with a wrong secret fails, `IK` with an
  unknown or forgotten key fails, a cut transfer resumes, a hash mismatch is
  refused and leaves no history entry, a disk refusal answers with its
  reason, `can_receive` holds at its boundary, every row of the diagnosis
  table maps to its message, and a data file with a mismatched recording is
  refused.
- On real devices: iPhone to Mac, Android to Windows, iPhone to Linux. Pair
  at home, then send on a hotspot. On a guest network that keeps devices
  apart, the phone names it and the hotspot guide gets the send through. A
  VPN on the phone, then on the laptop, is named with its advice. Airplane
  mode queues the send, and it goes out when the network returns with the app
  open. After "Forget" on the desktop, the next send is refused. A Share to a
  Mac by AirDrop, dropped on the desktop, keeps title, language, model and
  corrections.
- The logs of a full send contain no addresses, names or keys.
