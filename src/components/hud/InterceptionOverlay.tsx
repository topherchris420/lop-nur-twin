import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  CIRCUIT_AIRCRAFT_ID,
  getAircraftAnalysisProfile,
  getStructure,
  isVisibleAtTimelineYear,
} from '@/lib/layout';
import { getQualityProfile } from '@/lib/quality';
import { sceneProjection } from '@/lib/sceneProjection';
import { useTwinStore } from '@/lib/store';
import { terrainHeight } from '@/lib/terrain';

const TAU = Math.PI * 2;

export function InterceptionOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedId = useTwinStore((state) => state.selectedId);
  const activeTimelineYear = useTwinStore((state) => state.activeTimelineYear);
  const qualityTier = useTwinStore((state) => state.qualityTier);
  const reducedMotion = useTwinStore((state) => state.reducedMotion);
  const qualityProfile = getQualityProfile(qualityTier);
  const analysisProfile = selectedId
    ? getAircraftAnalysisProfile(selectedId)
    : undefined;
  const selectedStructure = selectedId ? getStructure(selectedId) : undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);

    const structureVisible =
      selectedStructure !== undefined &&
      isVisibleAtTimelineYear(selectedStructure, activeTimelineYear);
    const supported =
      selectedId !== null &&
      analysisProfile !== undefined &&
      (selectedId === CIRCUIT_AIRCRAFT_ID || structureVisible);
    if (!supported || selectedId === null || analysisProfile === undefined) return;

    const rangePointCount = qualityProfile.overlayRangeSamples;
    const radarPointCount = qualityProfile.overlayRadarSamples;
    const rangeCos = new Float32Array(rangePointCount + 1);
    const rangeSin = new Float32Array(rangePointCount + 1);
    for (let index = 0; index <= rangePointCount; index += 1) {
      const angle = (index / rangePointCount) * TAU;
      rangeCos[index] = Math.cos(angle);
      rangeSin[index] = Math.sin(angle);
    }

    const radarOffsetCos = new Float32Array(radarPointCount + 1);
    const radarOffsetSin = new Float32Array(radarPointCount + 1);
    const radarHalfFovRad = THREE.MathUtils.degToRad(
      analysisProfile.radarFovDeg * 0.5,
    );
    for (let index = 0; index <= radarPointCount; index += 1) {
      const offset =
        -radarHalfFovRad + (index / radarPointCount) * radarHalfFovRad * 2;
      radarOffsetCos[index] = Math.cos(offset);
      radarOffsetSin[index] = Math.sin(offset);
    }

    const centerWorld = new THREE.Vector3();
    const groundCenterWorld = new THREE.Vector3();
    const sampleWorld = new THREE.Vector3();
    const projectedCenter = new THREE.Vector3();
    const projectedGroundCenter = new THREE.Vector3();
    const projectedSample = new THREE.Vector3();
    const dashedLine: number[] = [6, 4];
    const solidLine: number[] = [];
    const scenarioLine = `${analysisProfile.label.toUpperCase()} · SCENARIO ${(analysisProfile.scenarioRadiusM / 1000).toFixed(1)} KM`;
    const radarLine = `RADAR ARC ${(analysisProfile.radarRangeM / 1000).toFixed(1)} KM · ${analysisProfile.radarFovDeg.toFixed(0)}° FOV`;
    const disclaimerLine = 'ILLUSTRATIVE — NOT OPERATIONAL DATA';
    const refreshHz = reducedMotion
      ? Math.min(8, qualityProfile.overlayRefreshHz)
      : qualityProfile.overlayRefreshHz;
    const refreshIntervalMs = 1000 / refreshHz;

    let cssWidth = 0;
    let cssHeight = 0;
    let backingDpr = 1;
    let activeCamera: THREE.Camera | null = null;
    let lastPaintAt = Number.NEGATIVE_INFINITY;
    let animationFrame = 0;

    const syncCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, rect.width);
      const nextHeight = Math.max(1, rect.height);
      const nextDpr = Math.min(
        window.devicePixelRatio || 1,
        qualityProfile.dprMax,
      );
      const backingWidth = Math.max(1, Math.round(nextWidth * nextDpr));
      const backingHeight = Math.max(1, Math.round(nextHeight * nextDpr));
      const changed =
        canvas.width !== backingWidth ||
        canvas.height !== backingHeight ||
        cssWidth !== nextWidth ||
        cssHeight !== nextHeight ||
        backingDpr !== nextDpr;
      if (!changed) return;
      cssWidth = nextWidth;
      cssHeight = nextHeight;
      backingDpr = nextDpr;
      canvas.width = backingWidth;
      canvas.height = backingHeight;
      lastPaintAt = Number.NEGATIVE_INFINITY;
    };

    const clearCanvas = () => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(backingDpr, 0, 0, backingDpr, 0, 0);
    };

    const projectWorld = (world: THREE.Vector3, out: THREE.Vector3): boolean => {
      if (!activeCamera || cssWidth <= 0 || cssHeight <= 0) return false;
      out.copy(world).project(activeCamera);
      if (
        !Number.isFinite(out.x) ||
        !Number.isFinite(out.y) ||
        !Number.isFinite(out.z) ||
        out.z < -1 ||
        out.z > 1
      ) {
        return false;
      }
      out.x = (out.x + 1) * 0.5 * cssWidth;
      out.y = (1 - out.y) * 0.5 * cssHeight;
      return true;
    };

    const strokeRange = (
      radiusM: number,
      color: string,
      lineWidth: number,
      dashed: boolean,
    ) => {
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.setLineDash(dashed ? dashedLine : solidLine);
      context.beginPath();
      let drawing = false;
      for (let index = 0; index <= rangePointCount; index += 1) {
        sampleWorld.set(
          groundCenterWorld.x + rangeCos[index]! * radiusM,
          groundCenterWorld.y,
          groundCenterWorld.z + rangeSin[index]! * radiusM,
        );
        if (projectWorld(sampleWorld, projectedSample)) {
          if (drawing) context.lineTo(projectedSample.x, projectedSample.y);
          else context.moveTo(projectedSample.x, projectedSample.y);
          drawing = true;
        } else {
          drawing = false;
        }
      }
      context.stroke();
    };

    const strokeRadarSector = (headingRad: number) => {
      const sinHeading = Math.sin(headingRad);
      const cosHeading = Math.cos(headingRad);
      const centerVisible = projectWorld(
        groundCenterWorld,
        projectedGroundCenter,
      );
      context.strokeStyle = 'rgba(116, 224, 214, 0.92)';
      context.fillStyle = 'rgba(116, 224, 214, 0.055)';
      context.lineWidth = 1.2;
      context.setLineDash(solidLine);
      context.beginPath();
      let drawing = false;
      if (centerVisible) {
        context.moveTo(projectedGroundCenter.x, projectedGroundCenter.y);
        drawing = true;
      }
      for (let index = 0; index <= radarPointCount; index += 1) {
        const offsetCos = radarOffsetCos[index]!;
        const offsetSin = radarOffsetSin[index]!;
        const directionX = -(sinHeading * offsetCos + cosHeading * offsetSin);
        const directionZ = -(cosHeading * offsetCos - sinHeading * offsetSin);
        sampleWorld.set(
          groundCenterWorld.x + directionX * analysisProfile.radarRangeM,
          groundCenterWorld.y,
          groundCenterWorld.z + directionZ * analysisProfile.radarRangeM,
        );
        if (projectWorld(sampleWorld, projectedSample)) {
          if (drawing) context.lineTo(projectedSample.x, projectedSample.y);
          else context.moveTo(projectedSample.x, projectedSample.y);
          drawing = true;
        } else {
          drawing = false;
        }
      }
      if (centerVisible && drawing) {
        context.lineTo(projectedGroundCenter.x, projectedGroundCenter.y);
        context.closePath();
        context.fill();
      }
      context.stroke();
    };

    const drawLegend = () => {
      const legendWidth = Math.min(310, Math.max(220, cssWidth - 24));
      const legendX = Math.max(12, (cssWidth - legendWidth) * 0.5);
      const legendY = cssHeight < 460 ? 58 : 66;
      context.fillStyle = 'rgba(20, 19, 16, 0.78)';
      context.strokeStyle = 'rgba(232, 228, 216, 0.22)';
      context.lineWidth = 1;
      context.fillRect(legendX, legendY, legendWidth, 62);
      context.strokeRect(legendX + 0.5, legendY + 0.5, legendWidth - 1, 61);
      context.fillStyle = '#f0bc68';
      context.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      context.fillText('NOTIONAL ANALYSIS ENVELOPE', legendX + 10, legendY + 15);
      context.fillStyle = 'rgba(232, 228, 216, 0.9)';
      context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
      context.fillText(scenarioLine, legendX + 10, legendY + 30);
      context.fillStyle = 'rgba(116, 224, 214, 0.9)';
      context.fillText(radarLine, legendX + 10, legendY + 43);
      context.fillStyle = 'rgba(232, 228, 216, 0.58)';
      context.fillText(disclaimerLine, legendX + 10, legendY + 56);
    };

    const draw = () => {
      activeCamera = sceneProjection.camera;
      if (
        !activeCamera ||
        sceneProjection.width <= 0 ||
        sceneProjection.height <= 0
      ) {
        clearCanvas();
        return;
      }

      let headingRad = 0;
      if (selectedId === CIRCUIT_AIRCRAFT_ID) {
        if (!sceneProjection.circuitAircraftActive) {
          clearCanvas();
          return;
        }
        centerWorld.copy(sceneProjection.circuitAircraftPosition);
        headingRad = sceneProjection.circuitAircraftHeadingRad;
      } else if (selectedStructure) {
        centerWorld.set(
          selectedStructure.position[0],
          Math.max(0.8, selectedStructure.size[1] * 0.5),
          selectedStructure.position[1],
        );
        headingRad = selectedStructure.rotation;
      } else {
        clearCanvas();
        return;
      }

      groundCenterWorld.set(
        centerWorld.x,
        terrainHeight(centerWorld.x, centerWorld.z) + 0.2,
        centerWorld.z,
      );
      clearCanvas();
      strokeRange(
        analysisProfile.scenarioRadiusM,
        'rgba(240, 188, 104, 0.92)',
        1.4,
        true,
      );
      strokeRange(
        analysisProfile.radarRangeM,
        'rgba(116, 224, 214, 0.52)',
        1,
        false,
      );
      strokeRadarSector(headingRad);

      if (projectWorld(centerWorld, projectedCenter)) {
        context.strokeStyle = '#f7c573';
        context.fillStyle = 'rgba(247, 197, 115, 0.18)';
        context.lineWidth = 1.5;
        context.setLineDash(solidLine);
        context.beginPath();
        context.arc(projectedCenter.x, projectedCenter.y, 6, 0, TAU);
        context.fill();
        context.stroke();
        context.beginPath();
        context.moveTo(projectedCenter.x - 10, projectedCenter.y);
        context.lineTo(projectedCenter.x + 10, projectedCenter.y);
        context.moveTo(projectedCenter.x, projectedCenter.y - 10);
        context.lineTo(projectedCenter.x, projectedCenter.y + 10);
        context.stroke();
      }

      drawLegend();
    };

    const loop = (timestamp: number) => {
      if (timestamp - lastPaintAt >= refreshIntervalMs) {
        lastPaintAt = timestamp;
        draw();
      }
      animationFrame = requestAnimationFrame(loop);
    };

    syncCanvasSize();
    const resizeObserver = new ResizeObserver(syncCanvasSize);
    resizeObserver.observe(canvas.parentElement ?? canvas);
    animationFrame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [
    activeTimelineYear,
    analysisProfile,
    qualityProfile,
    reducedMotion,
    selectedId,
    selectedStructure,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className='interception-overlay pointer-events-none absolute inset-0 z-[5] h-full w-full'
      aria-hidden='true'
    />
  );
}
