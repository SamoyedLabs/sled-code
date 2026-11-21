# AUR packaging

This directory maintains the [`t3code-bin`](https://aur.archlinux.org/packages/t3code-bin) and
[`t3code-nightly-bin`](https://aur.archlinux.org/packages/t3code-nightly-bin) packages. Both
are configured for x86_64 AppImages from Sled GitHub Releases.

## Publishing

The release script selects the stable or nightly package and looks up the AppImage and
SHA-256 digest for each architecture declared in its PKGBUILD. It builds for the host
architecture, regenerates `.SRCINFO`, and publishes when AUR credentials are supplied.

To validate a tag that publishes the required AppImage on Arch Linux:

```bash
sudo pacman -Syu --needed base-devel github-cli jq namcap
GH_TOKEN=$(gh auth token) RELEASE_TAG="$SLED_RELEASE_TAG" \
  packaging/aur/scripts/release.sh
```
