import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import {
  isSecretFormField,
  validateUiBlockResponse,
  type UiBlockSpec,
} from "@t3tools/contracts/openbot-ui-blocks";
import {
  createPrivilegedResponseController,
  type PrivilegedResponseScope,
} from "@t3tools/client-runtime/openbot/privileged-response";
import type {
  PrivilegedResponseRequest,
  PrivilegedResponseResult,
} from "@t3tools/contracts/openbot-privileged-response";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { T, Var, useGT } from "gt-react-native";
type Props = {
  scope: PrivilegedResponseScope;
  spec: UiBlockSpec;
  available: boolean;
  current: () => PrivilegedResponseScope | null;
  execute: (request: PrivilegedResponseRequest) => Promise<PrivilegedResponseResult>;
};
export function BotPrivilegedResponse(props: Props) {
  return <ResponseForm key={JSON.stringify(props.scope)} {...props} />;
}
function ResponseForm({ scope, spec, available, current, execute }: Props) {
  const gt = useGT();
  const [controller] = useState(() =>
    createPrivilegedResponseController(scope, { current, execute }),
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const [action, setAction] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Clear private inputs when iOS backgrounds or the original request unmounts.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        setValues({});
        setReady(false);
        controller.clearForm();
      }
    });
    return () => {
      subscription.remove();
      controller.close();
    };
  }, [controller]);
  if (!available)
    return (
      <Text>
        <T>Secure response is unavailable for this connection.</T>
      </Text>
    );
  const prepare = async () => {
    try {
      const opened = (await controller.prepare()) !== null;
      setReady(opened);
      if (!opened) setStatus(gt("This request is unavailable."));
    } catch {
      setStatus(gt("This request is unavailable."));
    }
  };
  const send = async () => {
    if (!action) return;
    const response = validateUiBlockResponse(spec, { actionId: action, values });
    if (!response) {
      setStatus(gt("Check the required fields."));
      return;
    }
    setValues({});
    setReady(false);
    setAction(null);
    const result = await controller.submit(response);
    setStatus(
      result?.status === "answered"
        ? gt("Response delivered.")
        : gt("Delivery is not confirmed. Check the result before taking further action."),
    );
  };
  return (
    <View>
      <Text>{spec.title}</Text>
      <Text>
        <T>
          For agent <Var>{scope.target.agentId}</Var>, thread <Var>{scope.target.threadId}</Var>.
        </T>
      </Text>
      {!ready && <Button label={gt("Open secure response")} onPress={() => void prepare()} />}
      {ready && (
        <>
          {spec.type === "form" &&
            spec.fields.map((field) => (
              <View key={field.id}>
                <Text>{field.label ?? field.id}</Text>
                {field.kind === "select" || field.kind === "segmented" ? (
                  field.options.map((option) => (
                    <Button
                      key={option}
                      label={option}
                      onPress={() => setValues({ ...values, [field.id]: option })}
                    />
                  ))
                ) : (
                  <AppTextInput
                    accessibilityLabel={field.label}
                    secureTextEntry={isSecretFormField(field)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={values[field.id] ?? ""}
                    onChangeText={(value) => setValues({ ...values, [field.id]: value })}
                  />
                )}
              </View>
            ))}
          {spec.type === "confirm" &&
            spec.fields?.map((field) => (
              <View key={"select" in field ? field.select : field.label}>
                <Text>{field.label}</Text>
                {"value" in field ? (
                  <Text>{field.value}</Text>
                ) : (
                  field.options.map((option) => (
                    <Button
                      key={option}
                      label={option}
                      onPress={() => setValues({ ...values, [field.select]: option })}
                    />
                  ))
                )}
              </View>
            ))}
          {spec.type === "confirm" ? (
            spec.actions.map((item) => (
              <Button key={item.id} label={item.label} onPress={() => setAction(item.id)} />
            ))
          ) : (
            <Button label={gt("Review submission")} onPress={() => setAction("submit")} />
          )}
          {action && <Button label={gt("Confirm and submit")} onPress={() => void send()} />}
          <Button
            label={gt("Close and clear")}
            onPress={() => {
              setValues({});
              setReady(false);
              setAction(null);
              controller.clearForm();
            }}
          />
        </>
      )}
      <Text accessibilityLiveRegion="polite">{status}</Text>
      {status !== "" && (
        <Button
          label={gt("Check result")}
          onPress={() =>
            void controller
              .result()
              .then((result) =>
                setStatus(
                  result?.status === "answered"
                    ? gt("Response delivered.")
                    : gt("Delivery is not confirmed."),
                ),
              )
              .catch(() => setStatus(gt("Result unavailable.")))
          }
        />
      )}
    </View>
  );
}
