/** Level of consciousness for triage (API values are stable slugs). */
export enum ConsciousnessLevel {
  /** Fully conscious. */
  ALERT = 'tinh_tao',
  /** Drowsy, responsive but not fully alert. */
  DROWSY = 'lo_mo',
  /** Lethargic, markedly decreased responsiveness. */
  LETHARGIC = 'li_bi',
  /** Comatose, unresponsive. */
  COMA = 'hon_me',
}
