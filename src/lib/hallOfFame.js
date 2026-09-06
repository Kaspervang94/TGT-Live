import { supabase } from "./supabase";

export async function getHallOfFame() {
  const { data, error } = await supabase
    .from("hall_of_fame")
    .select(`
      id,
      season,
      individual_champion,
      team_champion,
      final_course,
      created_at
    `)
    .order("season", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export function formatHallOfFameEntry(entry) {
  if (!entry) {
    return null;
  }

  return {
    id: entry.id,
    season: Number(entry.season),
    individualChampionName: entry.individual_champion,
    teamChampionName: entry.team_champion,
    finalCourse: entry.final_course,
    createdAt: entry.created_at,
  };
}

export function sortHallOfFame(entries) {
  return [...(entries ?? [])].sort(
    (a, b) => Number(b.season) - Number(a.season)
  );
}

export async function getFormattedHallOfFame() {
  const entries = await getHallOfFame();

  return sortHallOfFame(
    entries.map(formatHallOfFameEntry).filter(Boolean)
  );
}
