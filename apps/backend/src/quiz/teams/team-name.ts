export const MIN_TEAM_NAME = 2;
export const MAX_TEAM_NAME = 30;

/** Normalizes a team-lead-typed team name. '' (or whitespace) means "reset to default" and returns null; invalid input returns an error string. */
export function cleanTeamName(raw: unknown): { name: string | null } | { error: string } {
  if (raw == null) return { name: null };
  if (typeof raw !== 'string') return { error: 'Team name must be text' };
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name === '') return { name: null };
  if (name.length < MIN_TEAM_NAME || name.length > MAX_TEAM_NAME) {
    return { error: `Team name must be ${MIN_TEAM_NAME}-${MAX_TEAM_NAME} characters` };
  }
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return { error: 'Team name contains invalid characters' };
  return { name };
}
