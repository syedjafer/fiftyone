import { registerComponent, PluginComponentType } from "@fiftyone/plugins";
import { Schema } from "@fiftyone/utilities";
import Map from "./Map";

export { default as Map } from "./Map";

registerComponent({
  name: "Map",
  label: "Map",
  component: Map,
  type: PluginComponentType.Plot,
  activator: hasGeoField,
});

function hasGeoField({ schema }: { schema: Schema }) {
  for (const name in schema) {
    if (schema[name].embeddedDocType === "fiftyone.core.labels.GeoLocation") {
      return true;
    }
  }
  return false;
}
