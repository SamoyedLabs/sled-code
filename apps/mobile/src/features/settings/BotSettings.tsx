import { useState } from "react";
import { View } from "react-native";
import type { Json } from "effect/Schema";
import { SETTING_FORMS, settingRecord, settingOptions, settingRequest, type SettingsActions, type SettingsField } from "@t3tools/client-runtime/openbot/settings";
import { useBotSettings } from "./useBotSettings";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Picker } from "./BotConnectionControls";
import { BotSettingsAdvanced } from "./BotSettingsAdvanced";
export function BotSettings({ agentId, capabilities, actions }: { agentId?: string | undefined; capabilities: readonly string[]; actions: SettingsActions }) {
  const c = useBotSettings(actions); const [drafts, setDrafts] = useState<Readonly<Record<string, Json>>>({});
  return <View className="gap-4"><Text accessibilityRole="header">Bot settings</Text>
    {SETTING_FORMS.filter(form => form.agent === Boolean(agentId) && capabilities.includes(`${form.id}-v1`)).map(form => {
      const value = c.results[form.read] ?? c.results[form.update]; const data = settingRecord(value); const fields: readonly SettingsField[] = form.fields;
      const fieldValue = (field: SettingsField) => Object.hasOwn(drafts, `${form.id}:${field.key}`) ? drafts[`${form.id}:${field.key}`] ?? null : data[field.key] ?? null;
      const body: Record<string, Json> = form.agent && agentId ? { agentId } : {}; for (const field of fields) body[field.key] = fieldValue(field);
      const save = settingRequest(form.update, body); const read = settingRequest(form.read, form.agent && agentId ? { agentId } : {});
      return <View className="gap-2 rounded border p-3" key={form.id}><Text accessibilityRole="header">{form.label}</Text>
        <Button label="Refresh" disabled={c.busy || !read || !actions.can(read)} onPress={() => { void c.run(form.read, form.agent && agentId ? { agentId } : {}).then(result => { if (result !== null) setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${form.id}:`)))); }); }} />
        {value !== undefined && fields.map(field => { const draftKey = `${form.id}:${field.key}`; return field.text ? <View key={field.key}><Text>{field.label}</Text><AppTextInput accessibilityLabel={field.label} value={typeof fieldValue(field) === "string" ? String(fieldValue(field)) : ""} onChangeText={value => setDrafts(current => ({ ...current, [draftKey]: value || (field.nullable ? null : "") }))} /></View> : <Picker key={field.key} label={field.label} value={JSON.stringify(fieldValue(field))} disabled={c.busy} options={settingOptions(field, value).map(option => ({ id: JSON.stringify(option.value), name: option.label }))} onChange={selected => { const option = settingOptions(field, value).find(item => JSON.stringify(item.value) === selected); if (option) setDrafts(current => ({ ...current, [draftKey]: option.value })); }} />; })}
        <Button label="Save" disabled={c.busy || value === undefined || !save || !actions.can(save)} onPress={() => { void c.run(form.update, body); }} />
      </View>;
    })}
    <BotSettingsAdvanced agentId={agentId} capabilities={capabilities} actions={actions} />
    {c.notice && <Text accessibilityLiveRegion="polite">{c.notice}</Text>}
  </View>;
}
