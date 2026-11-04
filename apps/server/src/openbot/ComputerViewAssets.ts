export function rewriteComputerAsset(bytes: Uint8Array, upstreamId: string, publicBase: string) {
  return new TextDecoder()
    .decode(bytes)
    .replaceAll(`/v1/remote-screen/sessions/${upstreamId}`, publicBase)
    .replaceAll("^\\/v1\\/remote-screen", "^\\/api\\/openbot\\/computer-view\\/v1\\/remote-screen")
    .replaceAll(
      '"/v1/remote-screen/sessions/',
      '"/api/openbot/computer-view/v1/remote-screen/sessions/',
    )
    .replaceAll(
      "`/v1/remote-screen/sessions/",
      "`/api/openbot/computer-view/v1/remote-screen/sessions/",
    );
}
