# Code signing policy for this fork

`AoXIUy/token-monitor` publishes **unsigned** Windows x64 installer and portable executables, as selected by the repository maintainer. Windows may show an unknown publisher warning. This fork does not use the upstream SignPath organization or claim the SignPath Foundation signing identity.

## Verify a download

Compare the downloaded file against `SHA256SUMS` from the same Release:

```powershell
Get-FileHash ".\Token-Monitor-Setup-<version>.exe" -Algorithm SHA256
Get-AuthenticodeSignature ".\Token-Monitor-Setup-<version>.exe", ".\Token-Monitor-<version>.exe" | Format-List Path, Status, SignerCertificate
```

The fork's Windows application executable, installer and portable wrapper are expected to report `NotSigned`. The release workflow checks this before publishing. Checksums detect corruption; they do not establish an Authenticode publisher identity.

Windows installer updates use this fork's GitHub Releases over HTTPS and verify the SHA-512 hashes from update metadata. `build.win.verifyUpdateCodeSignature` is explicitly `false`; no signing publisher is embedded in `app-update.yml`. Portable builds update manually through View release. Never treat an unsigned package as a signed upstream build.

## Future signing setup

Before enabling signed releases, configure a signing identity authorized for this fork and restore the expected publisher checks for both packaging and updates. Keystore files, passwords and API tokens belong only in ignored local files or encrypted Actions Secrets.

The retained SignPath helper scripts and artifact configurations describe the upstream signing implementation. They are not used by this fork's release workflow and do not grant access to upstream signing. Original authorship and the MIT license remain intact.

See [the fork release guide](releasing-fork.md) and [privacy policy](privacy.md).
