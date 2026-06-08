"use client";
import ForceGraph2D from "react-force-graph-2d";

// next/dynamic's LoadableComponent is a plain function component, so a `ref` passed to a
// dynamically-imported component is dropped (never reaches the underlying graph). We route
// the ref through a normal `innerRef` prop instead, which survives the dynamic boundary and
// is applied here as the real ref — so graphRef.current gets the live ForceGraph instance.
export default function ForceGraph2DWrapped({ innerRef, ...props }: any) {
  return <ForceGraph2D ref={innerRef} {...props} />;
}
