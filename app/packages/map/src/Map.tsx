import { container } from "./Map.module.css";

import * as foc from "@fiftyone/components";
import { usePluginSettings } from "@fiftyone/plugins";
import * as fos from "@fiftyone/state";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import contains from "@turf/boolean-contains";
import { debounce } from "lodash";
import mapbox, { GeoJSONSource, LngLatBounds } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import React from "react";
import { useErrorHandler } from "react-error-boundary";
import Map, { Layer, MapRef, Source } from "react-map-gl";

import { useRecoilState, useRecoilValue } from "recoil";
import useResizeObserver from "use-resize-observer";

import useGeoLocations from "./useGeoLocations";
import DrawControl from "./Draw";

import {
  activeField,
  defaultSettings,
  mapStyle,
  MAP_STYLES,
  Settings,
} from "./state";
import Options from "./Options";

const fitBoundsOptions = { animate: false, padding: 30 };

const computeBounds = (
  data: GeoJSON.FeatureCollection<GeoJSON.Point, { id: string }>
) => {
  return data.features.reduce(
    (bounds, { geometry: { coordinates } }) =>
      bounds.extend(coordinates as [number, number]),
    new LngLatBounds()
  );
};

const fitBounds = (
  map: MapRef,
  data: GeoJSON.FeatureCollection<GeoJSON.Point, { id: string }>
) => {
  map.fitBounds(computeBounds(data), fitBoundsOptions);
};

const createSourceData = (samples: {
  [key: string]: [number, number];
}): GeoJSON.FeatureCollection<GeoJSON.Point, { id: string }> => {
  return {
    type: "FeatureCollection",
    features: Object.entries(samples).map(([id, coordinates]) => ({
      type: "Feature",
      properties: { id },
      geometry: { type: "Point", coordinates },
    })),
  };
};

const Plot: React.FC<{}> = () => {
  const theme = foc.useTheme();
  const dataset = useRecoilValue(fos.dataset);
  const view = useRecoilValue(fos.view);
  const filters = useRecoilValue(fos.filters);

  let { loading, samples } = useGeoLocations({
    dataset,
    filters,
    view,
    path: useRecoilValue(activeField),
  });
  const settings = usePluginSettings<Required<Settings>>(
    "map",
    defaultSettings
  );

  const style = useRecoilValue(mapStyle);
  const [selection, setSelection] = useRecoilState(fos.extendedSelection);

  const mapRef = React.useRef<MapRef>(null);
  const onResize = React.useMemo(
    () =>
      debounce(
        () => {
          mapRef.current && mapRef.current.resize();
        },
        0,
        {
          trailing: true,
        }
      ),
    []
  );
  const { ref } = useResizeObserver<HTMLDivElement>({
    onResize,
  });

  const data = React.useMemo(() => {
    let source = samples;

    if (selection) {
      source = selection.reduce((acc, cur) => {
        acc[cur] = samples[cur];
        return acc;
      }, {});
    }
    return createSourceData(source);
  }, [samples, selection]);

  const bounds = React.useMemo(() => computeBounds(data), [samples]);

  const [draw] = React.useState(
    () =>
      new MapboxDraw({
        displayControlsDefault: false,
        defaultMode: "draw_polygon",
      })
  );

  const onLoad = React.useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.on("click", "cluster", (event) => {
      event.preventDefault();
      const features = map.queryRenderedFeatures(event.point, {
        layers: ["cluster"],
      });
      draw.changeMode("simple_select");

      const clusterId = features[0].properties?.cluster_id;
      const source = map.getSource("points") as GeoJSONSource;
      source.getClusterExpansionZoom(clusterId, (error, zoom) => {
        if (error) return;

        const point = features[0].geometry as GeoJSON.Point;
        mapRef.current?.easeTo({
          center: point.coordinates as [number, number],
          zoom: zoom,
        });
      });
    });

    const pointer = () => (map.getCanvas().style.cursor = "pointer");
    const crosshair = () => (map.getCanvas().style.cursor = "crosshair");
    const drag = () => (map.getCanvas().style.cursor = "all-scroll");
    map.on("mouseenter", "cluster", pointer);
    map.on("mouseleave", "cluster", crosshair);
    map.on("mouseenter", "point", () => pointer);
    map.on("mouseleave", "point", () => crosshair);
    map.on("dragstart", drag);
    map.on("dragend", crosshair);
  }, []);

  const length = React.useMemo(() => Object.keys(samples).length, [samples]);

  React.useEffect(() => {
    mapRef.current && fitBounds(mapRef.current, data);
  }, [data]);

  if (!settings.mapboxAccessToken) {
    return <foc.Loading>No Mapbox token provided</foc.Loading>;
  }

  if (!Object.keys(samples).length && !loading) {
    return <foc.Loading>No data</foc.Loading>;
  }

  return (
    <div className={container} ref={ref}>
      {loading && !length ? (
        <foc.Loading style={{ opacity: 0.5 }}>Pixelating...</foc.Loading>
      ) : (
        <Map
          ref={mapRef}
          mapLib={mapbox}
          mapStyle={`mapbox://styles/mapbox/${MAP_STYLES[style]}`}
          initialViewState={{
            bounds,
            fitBoundsOptions,
          }}
          onStyleData={() => {
            mapRef.current &&
              (mapRef.current.getCanvas().style.cursor = "crosshair");
          }}
          mapboxAccessToken={settings.mapboxAccessToken}
          onLoad={onLoad}
          onRender={() => {
            try {
              if (draw.getMode() !== "draw_polygon") {
                draw.changeMode("draw_polygon");
              }
            } catch {}
          }}
        >
          <Source
            id="points"
            type="geojson"
            data={data}
            cluster={settings.clustering}
            clusterMaxZoom={settings.clusterMaxZoom}
          >
            {settings.clustering && (
              <Layer
                id={"cluster"}
                filter={["has", "point_count"]}
                paint={{
                  "circle-color": theme.brand,
                  "circle-opacity": 0.7,
                  "circle-radius": [
                    "step",
                    ["get", "point_count"],
                    20,
                    10,
                    30,
                    25,
                    40,
                  ],
                  ...settings.clusters.paint,
                }}
                type={"circle"}
              />
            )}
            {settings.clustering && (
              <Layer
                id={"cluster-count"}
                filter={["has", "point_count"]}
                layout={{
                  "text-field": "{point_count_abbreviated}",
                  "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
                  "text-size": 12,
                }}
                paint={settings.clusters.textPaint}
                type={"symbol"}
              />
            )}

            <Layer
              id={"point"}
              filter={["!", ["has", "point_count"]]}
              paint={settings.pointPaint}
              type={"circle"}
            />
          </Source>
          <DrawControl
            draw={draw}
            onCreate={(event) => {
              const {
                features: [polygon],
              } = event;
              const selected = new Set<string>();

              for (let index = 0; index < data.features.length; index++) {
                if (
                  contains(
                    polygon as GeoJSON.Feature<GeoJSON.Polygon>,
                    data.features[index]
                  )
                ) {
                  selected.add(data.features[index].properties.id);
                }
              }

              if (!selected.size) {
                return;
              }

              setSelection([...selected]);
            }}
          />
        </Map>
      )}

      <Options
        fitData={() => mapRef.current && fitBounds(mapRef.current, data)}
        fitSelectionData={() =>
          mapRef.current && fitBounds(mapRef.current, data)
        }
        clearSelectionData={() => setSelection(null)}
      />
    </div>
  );
};

export default Plot;
