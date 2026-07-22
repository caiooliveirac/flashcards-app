/**
 * Motion System — "Camada de Vida" (handoff/HANDOFF-motion.md).
 *
 * Uso típico:
 *   - marcação: `data-ms-ripple="create"`, `data-ms-magnetic`, `data-ms-tilt="8"`
 *   - coreografia: `emitMotion("card:saved", { sourceEl, deckEl })`
 *   - números: `<LiveCount value={n} />`  ·  texto: `<KineticText text="..." />`
 */

export { startMotionSystem } from "./behaviors";
export { emitMotion, onMotion, type MotionEventMap, type MotionEventName } from "./events";
export {
  FIELD_MODES,
  motionTokens,
  RIPPLE_KINDS,
  SPRING,
  tiltForTemperature,
  type FieldMode,
  type RippleKind,
} from "./tokens";
