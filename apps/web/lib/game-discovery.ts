import type {
  GamePlatform,
  GameStatus,
  PublicProjectRecord
} from "./creator-application";

export type GameDiscoveryFilters = {
  query: string;
  status: GameStatus | "all";
  platform: GamePlatform | "all";
};

function publishedTime(value: unknown) {
  return value && typeof value === "object" && "toMillis" in value
    && typeof (value as { toMillis?: unknown }).toMillis === "function"
    ? (value as { toMillis: () => number }).toMillis()
    : 0;
}

export function sortGameProjects(projects: PublicProjectRecord[]) {
  const statusOrder: Record<GameStatus | "", number> = {
    live: 0,
    playable: 1,
    development: 2,
    concept: 3,
    "": 4
  };
  return projects
    .filter((project) => project.projectType === "gaming" || project.availableModules.includes("game"))
    .sort((left, right) => statusOrder[left.gameStatus] - statusOrder[right.gameStatus]
      || publishedTime(right.publishedAt) - publishedTime(left.publishedAt)
      || left.name.localeCompare(right.name));
}

export function filterGameProjects(
  projects: PublicProjectRecord[],
  filters: GameDiscoveryFilters
) {
  const query = filters.query.trim().toLowerCase();
  return projects.filter((project) => {
    const status = project.gameStatus || "development";
    const searchText = [
      project.name,
      project.summary,
      project.gameGenre,
      status,
      ...project.gamePlatforms,
      ...project.gameModes
    ].join(" ").toLowerCase();
    return (!query || searchText.includes(query))
      && (filters.status === "all" || status === filters.status)
      && (filters.platform === "all" || project.gamePlatforms.includes(filters.platform));
  });
}
