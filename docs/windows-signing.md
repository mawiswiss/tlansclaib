# Windows signing

The Windows installer is not signed yet. This page compares the ways to sign
it, with prices as of October 2026, and describes the setup for the
recommended one. Signing waits until there is an organisation to sign as.

## What signing changes

A signed installer names its publisher, where an unsigned one shows "Unknown
publisher". The SmartScreen screen "Windows protected your PC" stays for a
while under every option, because reputation builds per publisher as
downloads accumulate. Since 2024, extended validation certificates no longer
skip that. Every release signed with the same identity keeps the reputation,
and a new publisher name starts again from zero.

An installer that the in-app updater downloads carries no browser download
mark, so SmartScreen should ask only on the first manual install. This still
needs a check on a real Windows machine. Until signing is in place, the
release notes keep the hint "More info, then Run anyway".

## Who can sign

Since June 2023, the private key of a code signing certificate has to live in
hardware, either on a USB token or in a certificate authority's cloud signing
service. The release workflow needs the cloud variant, because a hosted GitHub
runner cannot hold a token.

Microsoft's [Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/quickstart),
formerly Trusted Signing, issues certificates to individuals in the US and
Canada only. Organisations qualify in more countries. An individual elsewhere
signs with a certificate from a certificate authority.

## Options and costs

Costs are per year and cover signing only.

| Route | For | Per year | Publisher shown | From GitHub Actions | Limits |
|---|---|---|---|---|---|
| Artifact Signing, Basic | Organisation | about $120 ($9.99 a month, 5,000 signatures a month) | Organisation | Yes | Eligibility, see below. Billing starts when the account is created. |
| SSL.com organisation validation (OV) with eSigner | Organisation | $129 + $180 = $309 | Organisation | Yes, with a stored one-time password secret | Needs a registered organisation. |
| Extended validation (EV) | Organisation | $400 and more | Organisation | Depends on the certificate authority | No SmartScreen advantage over OV since 2024. |
| SSL.com individual validation (IV) with eSigner | Individual | $129 + $180 = $309 | The person's legal name | Yes | The name changes when an organisation takes over. |
| Certum Open Source, cloud | Individual | about €49 | "Open Source Developer" and the name | Hard, because each run needs a code from a phone app | Non-commercial software only. |
| SignPath Foundation | Open source project | Free | SignPath Foundation | Yes | Not the project's own name, and no commercial dual licensing. |
| Unsigned | | 0 | Unknown publisher | | SmartScreen asks on the first install. |

The $180 is the yearly [eSigner plan](https://www.ssl.com/guide/esigner-pricing/)
with 240 signatures, and each further one costs $1. OV and IV certificates
bought for several years cost less per year, an OV certificate for three years
$109.65 a year. Since 2026 a single certificate lasts at most 459 days, so a
multi-year purchase is reissued in between.

The Microsoft Store signs MSIX packages for free. Tauri builds no MSIX,
though, and the Store would replace the GitHub download and the updater on
Windows.

## Recommendation

Sign as an organisation with Artifact Signing, which costs less than half of
a certificate authority's offer. If Microsoft refuses the organisation, use an
OV certificate with cloud signing. A certificate in a private name works
today, but its reputation is lost once an organisation's name replaces it.

## Before creating the Azure account

Three questions can block Artifact Signing, and billing starts with the
account, so settle them first.

1. Country. The Artifact Signing quickstart and Microsoft's
   [code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
   page list different countries for organisations. The quickstart is the
   service's own documentation and the more specific of the two, but check
   the organisation's country against both.
2. Age. Microsoft's MSIX signing guidance is quoted as requiring three or
   more years of verifiable tax history, while the quickstart names no
   minimum. Answers on Microsoft Q&A go both ways, and threads from 2026 show
   newly founded companies failing validation without a reason given.
3. Legal form. It is unclear whether a sole proprietorship counts as an
   organisation or as an individual. As an individual it is refused outside
   the US and Canada.

Ask Microsoft support with the organisation's real details before creating the
account. If validation fails anyway, delete the Artifact Signing account,
because billing runs per account and not per validation.

## Setup with Artifact Signing

### Azure

1. An Azure subscription in the organisation's name, with the
   `Microsoft.CodeSigning` resource provider registered.
2. An Artifact Signing account on the Basic tier, in a region that offers the
   service. The quickstart lists the regions and their endpoints.
3. An identity validation of type Organization and Public, in the Azure
   portal. It needs the legal name, a business identifier, the website, a
   primary and a secondary email address on the organisation's domain, and
   the address. A representative then verifies with a government ID.
   Microsoft gives 1 to 20 business days for it.
4. A certificate profile of type Public Trust that uses this identity.
5. An app registration in Entra ID for the release workflow, with the role
   "Artifact Signing Certificate Profile Signer" scoped to the certificate
   profile.

### Repository

- `src-tauri/tauri.signing.conf.json` holds the sign command. It contains no
  secret, so it is committed. The endpoint belongs to the account's region.

  ```json
  {
    "bundle": {
      "windows": {
        "signCommand": "artifact-signing-cli -e <endpoint> -a <account> -c <profile> -d tlansclaib %1"
      }
    }
  }
  ```

- The repository secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and
  `AZURE_CLIENT_SECRET` hold the app registration's credentials.
- `release.yml` gets a step for the Windows job, "Sign the Windows build, once
  Artifact Signing is set", shaped like the updater step. Without
  `AZURE_CLIENT_ID` it does nothing, so forks keep building unsigned. With it,
  the step installs `artifact-signing-cli` with `cargo install`, exports the
  three variables and sets
  `SIGNING_ARGS=--config src-tauri/tauri.signing.conf.json`. The `args:` line
  of tauri-action becomes
  `${{ matrix.args }} ${{ env.UPDATER_ARGS }} ${{ env.SIGNING_ARGS }}`, and
  Tauri CLI 2.12 merges several `--config` flags in the order given.
- Tauri then runs the sign command on the app, both engine sidecars, the NSIS
  plugins, the uninstaller and the installer.
- The Signing section in `docs/release.md` describes the setup in place of
  "The Windows installer is not signed".

[Tauri's Windows signing guide](https://v2.tauri.app/distribute/sign/windows/)
has the details of `artifact-signing-cli`.

### Checks on the first signed build

- The windows-2022 runner has what Tauri's guide asks for: .NET 8, and
  signtool from Windows SDK 10.0.26100 or later. If not, the signing step
  installs them.
- GitHub's OpenID Connect login may replace the client secret, which would
  leave no long-lived secret in the repository. This is untested.
- Every signed file verifies and carries a timestamp. `signtool verify /pa /v`
  or `Get-AuthenticodeSignature` shows it, on the installer and on the
  installed app and both sidecars.
- The updater's `.sig` still matches the signed installer, and an update
  from the last unsigned version installs.

## Fallback with a certificate authority

Tauri's `signCommand` accepts any command that signs a file, so SSL.com's
CodeSignTool can take the place of `artifact-signing-cli` with an OV or IV
certificate. Its credentials, including the stored one-time password secret,
go into repository secrets. This route is untested here. Count the signatures
of one release first, because the cheapest eSigner plan includes 240 a year.

## Risks

- Microsoft refuses a young organisation. The fallback then costs about $309
  a year.
- Reputation builds slowly, so new releases show the SmartScreen warning for a
  while, whichever certificate signs them.
- A leaked client secret lets anyone sign as the organisation. The role is
  scoped to the profile for that reason, and the secret gets rotated after a
  leak.
- Any change of the publisher name, such as a rename of the organisation,
  restarts reputation.
