import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { FeatureRequestScreen } from "./client/screens/feature-request-screen";

function OrchivaItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Layers"
      active={currentScreen?.screenId === "feature-request"}
      onPress={() => openScreen({ screenId: "feature-request" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "feature-request", title: "Orchiva · Feature Request", Component: FeatureRequestScreen });
  client.addSidebarHeaderItem({ id: "orchiva", title: "Orchiva", Component: OrchivaItem });
  return () => {};
}
