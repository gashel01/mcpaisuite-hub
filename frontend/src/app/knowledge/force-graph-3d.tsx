"use client";
import ForceGraph3D from "react-force-graph-3d";

// See force-graph-2d.tsx — next/dynamic drops `ref`, so we forward it via an `innerRef`
// prop and apply it as the real ref here, giving graphRef.current the live 3D instance
// (camera(), cameraPosition(), controls(), …).
export default function ForceGraph3DWrapped({ innerRef, ...props }: any) {
  return <ForceGraph3D ref={innerRef} {...props} />;
}
