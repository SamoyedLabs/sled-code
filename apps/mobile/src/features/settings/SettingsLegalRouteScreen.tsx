import { useGT } from "gt-react-native";
import { SettingsLegalDocumentRouteScreen } from "./components/SettingsLegalDocumentRouteScreen";
import { LEGAL_URL } from "./lib/legal-document-url";

export function SettingsLegalRouteScreen() {
  const gt = useGT();
  return (
    <SettingsLegalDocumentRouteScreen
      documentName={gt("Privacy policy", { $context: "legal documents page title" })}
      documentUrl={LEGAL_URL}
    />
  );
}
