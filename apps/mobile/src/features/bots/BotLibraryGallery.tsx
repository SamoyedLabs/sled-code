import {
  OPENBOT_LIBRARY_PREVIEW_LIMIT,
  OPENBOT_LIBRARY_AUTOMATIC_IMAGE_LIMIT,
  OpenbotLibraryPicture,
  OpenbotLibraryPictureMime,
  type EnvironmentId,
  type OpenbotLibraryFile,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Image } from "expo-image";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  // oxlint-disable-next-line eslint/no-restricted-imports -- Horizontal full-screen paging modal relies on FlatList pagingEnabled and getItemLayout.
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { openbot } from "../../state/openbot";
import { useFreshAssetUrl } from "../../state/assets";
import { useEnvironmentQuery } from "../../state/query";
import { BotGlass, BotIconButton } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";
import { useGT } from "gt-react-native";

type FileScope = {
  environmentId: EnvironmentId;
  hostId: string;
  file: OpenbotLibraryFile;
  streamingImages: boolean;
};
const decodePicture = Schema.decodeUnknownOption(OpenbotLibraryPicture);
const isPictureMime = Schema.is(OpenbotLibraryPictureMime);

function useLibraryPicture(
  { environmentId, hostId, file, streamingImages }: FileScope,
  enabled = true,
) {
  const [revision, setRevision] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const automatic =
    file.size > 0 &&
    file.size <= OPENBOT_LIBRARY_AUTOMATIC_IMAGE_LIMIT &&
    isPictureMime(file.mimeType);
  const streamed = streamingImages && automatic;
  const signed = useFreshAssetUrl(
    environmentId,
    enabled && streamed
      ? {
          _tag: "bot-library-image",
          hostId,
          fileId: file.id,
          ...(file.conversation ? { conversationId: file.conversation.id } : {}),
        }
      : null,
    revision,
  );
  const preview = useEnvironmentQuery(
    enabled && !streamed && automatic && file.size <= OPENBOT_LIBRARY_PREVIEW_LIMIT
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: {
              operation: "library.files.preview",
              fileId: file.id,
              ...(file.conversation ? { conversationId: file.conversation.id } : {}),
            },
          },
        })
      : null,
  );
  const picture = useMemo(() => decodePicture(preview.data), [preview.data]);
  const retry = () => setRevision((current) => current + 1);
  if (streamed) {
    const url = signed._tag === "Success" ? signed.value.url : null;
    return {
      uri: url !== failedUrl ? url : null,
      pending: enabled && (signed._tag === "Initial" || signed.waiting),
      streamed,
      onImageError: () => {
        if (revision === 0) retry();
        else setFailedUrl(url);
      },
      retry,
    };
  }
  return {
    uri:
      picture._tag === "Some"
        ? `data:${picture.value.mimeType};base64,${picture.value.base64}`
        : null,
    pending: preview.isPending,
    streamed,
    onImageError: undefined,
    retry: preview.refresh,
  };
}

export function LibraryPicture(scope: FileScope) {
  const { uri, onImageError } = useLibraryPicture(scope);
  return (
    uri && (
      <Image
        accessible={false}
        pointerEvents="none"
        accessibilityIgnoresInvertColors
        source={{ uri }}
        onError={onImageError}
        cachePolicy="memory"
        contentFit="cover"
        style={StyleSheet.absoluteFill}
        transition={120}
      />
    )
  );
}

type Resolve = (file: OpenbotLibraryFile, signal: AbortSignal) => Promise<{ uri: string } | null>;

function GalleryPage({
  width,
  height,
  front,
  resolve,
  onZoom,
  ...scope
}: FileScope & {
  width: number;
  height: number;
  front: boolean;
  resolve: Resolve;
  onZoom(zoom: boolean): void;
}) {
  const gt = useGT();
  const original = useLibraryPicture(scope);
  const shouldAsk = scope.file.size > OPENBOT_LIBRARY_AUTOMATIC_IMAGE_LIMIT;
  const [download, setDownload] = useState(!shouldAsk);
  const [fetched, setFetched] = useState<{ uri: string | null } | null>(null);
  const load = useEffectEvent((signal: AbortSignal) => resolve(scope.file, signal));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Download the active page only, cancel on paging or closing.
  useEffect(() => {
    if (!front || original.streamed || original.uri || original.pending || !download || fetched)
      return;
    const controller = new AbortController();
    void load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setFetched({ uri: result?.uri ?? null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetched({ uri: null });
      });
    return () => controller.abort();
  }, [download, fetched, front, original.pending, original.streamed, original.uri]);

  const uri = original.uri ?? fetched?.uri;
  return (
    <View style={{ width, height, justifyContent: "center" }}>
      {uri ? (
        <ScrollView
          centerContent
          minimumZoomScale={1}
          maximumZoomScale={5}
          pinchGestureEnabled
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onScroll={({ nativeEvent }) => {
            if (front) onZoom((nativeEvent.zoomScale ?? 1) > 1.01);
          }}
          scrollEventThrottle={32}
        >
          <Image
            accessible
            accessibilityRole="image"
            accessibilityLabel={scope.file.name}
            source={{ uri }}
            onError={original.onImageError}
            cachePolicy="memory"
            contentFit="contain"
            style={{ width, height }}
          />
        </ScrollView>
      ) : front && original.streamed && !original.pending ? (
        <View style={{ alignSelf: "center" }}>
          <Button label={gt("Retry loading photo")} onPress={original.retry} />
        </View>
      ) : !download || fetched ? (
        <View style={{ alignSelf: "center" }}>
          <Button
            label={fetched ? gt("Retry loading photo") : gt("Download photo")}
            onPress={() => {
              setFetched(null);
              setDownload(true);
            }}
          />
        </View>
      ) : (
        <ActivityIndicator color="white" accessibilityLabel={gt("Loading photo")} />
      )}
    </View>
  );
}

export function BotLibraryGallery({
  files,
  initialIndex,
  onClose,
  canShare,
  resolve,
  share,
  ...scope
}: Omit<FileScope, "file"> & {
  files: readonly OpenbotLibraryFile[];
  initialIndex: number;
  onClose(): void;
  canShare: boolean;
  resolve: Resolve;
  share(file: OpenbotLibraryFile, signal: AbortSignal): Promise<void>;
}) {
  const gt = useGT();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sharingAbort = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Cancel an active share if its route leaves.
  useEffect(() => () => sharingAbort.current?.abort(), []);
  const active = files[index];
  if (!active) return null;

  function close() {
    sharingAbort.current?.abort();
    onClose();
  }

  function openShare() {
    if (!active || !canShare || sharingAbort.current) return;
    const controller = new AbortController();
    sharingAbort.current = controller;
    setSharing(true);
    void share(active, controller.signal)
      .catch(() => {
        if (!controller.signal.aborted)
          Dialog.alert(gt("Could not share this file"), gt("Try again."));
      })
      .finally(() => {
        if (sharingAbort.current !== controller) return;
        sharingAbort.current = null;
        setSharing(false);
      });
  }

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={close}>
      <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: "#000" }}>
        <FlatList
          horizontal
          pagingEnabled
          initialScrollIndex={initialIndex}
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          data={files}
          keyExtractor={(file) => file.id}
          getItemLayout={(_data, item) => ({ index: item, length: width, offset: item * width })}
          initialNumToRender={1}
          windowSize={3}
          onMomentumScrollEnd={({ nativeEvent }) => {
            setZoomed(false);
            setIndex(
              Math.max(
                0,
                Math.min(files.length - 1, Math.round(nativeEvent.contentOffset.x / width)),
              ),
            );
          }}
          renderItem={({ item, index: itemIndex }) => (
            <GalleryPage
              {...scope}
              file={item}
              width={width}
              height={height}
              front={itemIndex === index}
              resolve={resolve}
              onZoom={setZoomed}
            />
          )}
        />
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            left: 14,
            right: 14,
            top: insets.top + 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <BotGlass>
            <BotIconButton label={gt("Close gallery")} icon="xmark" onPress={close} />
          </BotGlass>
          <BotGlass style={{ flexShrink: 1, borderRadius: 22 }}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={{ color: "white", paddingHorizontal: 16, paddingVertical: 10 }}
            >
              {active.name}
            </Text>
          </BotGlass>
          <BotGlass>
            <BotIconButton
              label={gt("Share photo")}
              icon="square.and.arrow.up"
              disabled={!canShare || sharing}
              onPress={openShare}
            />
          </BotGlass>
        </View>
        {files.length > 1 && (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              position: "absolute",
              alignSelf: "center",
              bottom: insets.bottom + 12,
              color: "white",
              paddingHorizontal: 14,
              paddingVertical: 5,
              borderRadius: 14,
              backgroundColor: "#0009",
            }}
          >
            {index + 1} of {files.length}
          </Text>
        )}
      </View>
    </Modal>
  );
}
