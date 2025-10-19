/* Types */

interface GameModeConfig {
  score: number;
  timeLimit: number;
  freezeTime: number;
  progressStageEarly: number;
  progressStageMid: number;
  progressStageLate: number;
  team1ID: number;
  team2ID: number;
  hqRoundStartTeam1: number;
  hqRoundStartTeam2: number;
  hqInProgressTeam1: number;
  hqInProgressTeam2: number;
  respawnAreaTriggerID: number;
  maxStartingAmmo: boolean;
  startSpawnPointID: number;
}

interface PlayerStats {
  k: number;
  d: number;
  a: number;
  hs: number;
}

/* Mode config - Only modify what's inside this object */
const GAMEMODE_CONFIG: GameModeConfig = {
  score: 75, // 75 kills to win
  freezeTime: 15, // Seconds of freeze time at round start
  timeLimit: 10 * 60 + 15, // 10 minutes + freeze time
  progressStageEarly: 20, // How many kills to trigger early progress VO
  progressStageMid: 40, // How many kills to trigger mid progress VO
  progressStageLate: 65, // How many kills to trigger late progress VO
  team1ID: 1,
  team2ID: 2,
  // Beginning HQs - place these in Godot where players spawn at match start
  hqRoundStartTeam1: 1,
  hqRoundStartTeam2: 2,
  // In-progress HQs - place these outside the map, surrounded by area trigger
  hqInProgressTeam1: 11,
  hqInProgressTeam2: 12,
  respawnAreaTriggerID: 1000, // AreaTrigger that surrounds the in-progress HQs
  maxStartingAmmo: true,
  startSpawnPointID: 9001, // Starting ID for spawn point SpatialObjects. Your spawners need to be a SpatialObject (any object that is an actual prop) in incremental IDs starting from startSpawnPointID or they'll not be parsed
};

/* Gamemode variables */

const spawners: mod.Vector[] = [];

const UIWIDGET_TIMER_BEGINNING_ID = "UIWidgetTimerBeginning";
const UIWIDGET_TIMER_BEGINNING_TEXT_ID = "UIWidgetTimerBeginningText";
const UIWIDGET_SCORE_CONTAINER_ID = "UIWidgetContainer";
const UIWIDGET_SCORE_TIMER_ID = "UIWidgetTimer";
const UIWIDGET_SCORE_SEPARATOR_ID = "UIWidgetSeparator";
const UIWIDGET_SCORE_TEAM1_SCORE_ID = "UiWidgetTeam1Score";
const UIWIDGET_SCORE_TEAM1_NAME_ID = "UiWidgetTeam1Name";
const UIWIDGET_SCORE_TEAM2_SCORE_ID = "UiWidgetTeam2Score";
const UIWIDGET_SCORE_TEAM2_NAME_ID = "UiWidgetTeam2Name";
const UIWIDGET_SCORE_FIRSTTO_ID = "UiWidgetFirstTo";

const playersStats: { [id: number]: PlayerStats } = {};

let gameStarted = false;
let gameEnded = false;

let leaderTeam: mod.Team | null = null;

let tick = 0;

let hasPlayedTime120LeftVO = false;
let hasPlayedTime30LeftVO = false;
let hasPlayedTime60LeftVO = false;

const winProgressStages = {
  [GAMEMODE_CONFIG.progressStageEarly]: {
    winning: mod.VoiceOverEvents2D.ProgressEarlyWinning,
    losing: mod.VoiceOverEvents2D.ProgressEarlyLosing,
    hasPlayed: false,
  },
  [GAMEMODE_CONFIG.progressStageMid]: {
    winning: mod.VoiceOverEvents2D.ProgressLateWinning,
    losing: mod.VoiceOverEvents2D.ProgressLateLosing,
    hasPlayed: false,
  },
  [GAMEMODE_CONFIG.progressStageLate]: {
    winning: mod.VoiceOverEvents2D.PlayerCountEnemyLow,
    losing: mod.VoiceOverEvents2D.PlayerCountFriendlyLow,
    hasPlayed: false,
  },
};

/* Helper Functions */

function playSFX(sfxId: mod.RuntimeSpawn_Common) {
  const sfx = mod.SpawnObject(
    sfxId,
    mod.CreateVector(0, 0, 0),
    mod.CreateVector(0, 0, 0),
    mod.CreateVector(0, 0, 0)
  );

  mod.EnableSFX(sfx, true);
  mod.PlaySound(sfx, 100);
}

function playVO(vo: mod.VoiceOverEvents2D, team?: any) {
  const voModule: mod.VO = mod.SpawnObject(
    mod.RuntimeSpawn_Common.SFX_VOModule_OneShot2D,
    mod.CreateVector(0, 0, 0),
    mod.CreateVector(0, 0, 0)
  );

  if (team) {
    mod.PlayVO(voModule, vo, mod.VoiceOverFlags.Alpha, team);
  } else {
    mod.PlayVO(voModule, vo, mod.VoiceOverFlags.Alpha);
  }
}

function playProgressSFX(team1: mod.Team, team2: mod.Team) {
  const team1Score = mod.GetGameModeScore(team1);
  const team2Score = mod.GetGameModeScore(team2);
  if (team1Score === team2Score) {
    return;
  }

  const isTeam1Winning = team1Score > team2Score;
  const winningTeam = isTeam1Winning ? team1 : team2;
  const losingTeam = isTeam1Winning ? team2 : team1;
  const winningTeamScore = Math.max(team1Score, team2Score);

  const stage =
    winProgressStages[winningTeamScore as keyof typeof winProgressStages];
  if (stage && !stage.hasPlayed) {
    playVO(stage.winning, winningTeam);
    playVO(stage.losing, losingTeam);
    stage.hasPlayed = true;
  }

  if (leaderTeam === null || !mod.Equals(winningTeam, leaderTeam)) {
    leaderTeam = winningTeam;
    if (!stage) {
      playVO(mod.VoiceOverEvents2D.ProgressMidWinning, winningTeam);
      playVO(mod.VoiceOverEvents2D.ProgressMidLosing, losingTeam);
    }
  }
}

function getFurthestSpawnPointFromEnemies(
  respawnedPlayer: mod.Player
): mod.Vector {
  const players = mod.AllPlayers();

  let furthestSpawnPoint = spawners[0];
  let furthestSpawnPointDistance = 0;

  for (const spawnPointVector of spawners) {
    let nearestPlayerDistance = 999999999;

    for (let i = 0; i < mod.CountOf(players); i++) {
      const player: mod.Player = mod.ValueInArray(players, i);

      if (
        mod.GetSoldierState(player, mod.SoldierStateBool.IsDead) ||
        mod.Equals(mod.GetTeam(player), mod.GetTeam(respawnedPlayer))
      ) {
        continue;
      }

      const playerVector = mod.GetSoldierState(
        player,
        mod.SoldierStateVector.GetPosition
      );
      const distanceBetween = mod.DistanceBetween(
        spawnPointVector,
        playerVector
      );

      nearestPlayerDistance = Math.min(nearestPlayerDistance, distanceBetween);
    }

    if (furthestSpawnPointDistance < nearestPlayerDistance) {
      furthestSpawnPoint = spawnPointVector;
      furthestSpawnPointDistance = nearestPlayerDistance;
    }
  }

  return furthestSpawnPoint;
}

function createSpawnPoints() {
  let spawnPointId = GAMEMODE_CONFIG.startSpawnPointID;
  do {
    const spawnPoint = mod.GetSpatialObject(spawnPointId); // Even with an invalid ID it returns a SpawnObject so we have to check it by "hand"
    const spawnPointPosition = mod.GetObjectPosition(spawnPoint);
    const spawnPointX = mod.XComponentOf(spawnPointPosition); //Not used for check since for some reason it's not 0 but 1e-7...
    const spawnPointY = mod.YComponentOf(spawnPointPosition);
    const spawnPointZ = mod.ZComponentOf(spawnPointPosition);

    if (spawnPointY === 0 && spawnPointZ === 0) {
      // So far the only way I know to check if something exists
      break;
    }

    spawners.push(mod.CreateVector(spawnPointX, spawnPointY, spawnPointZ));
    mod.MoveObject(spawnPoint, mod.CreateVector(-100, -100, -100)); // Because EnableSpatial and Unspawn don't work...
    spawnPointId++;
  } while (spawnPointId);
}

/* Scoreboard helpers */

function createScoreboard() {
  mod.SetScoreboardColumnNames(
    mod.Message(mod.stringkeys.SCOREBOARD_COLUMN1_HEADER),
    mod.Message(mod.stringkeys.SCOREBOARD_COLUMN2_HEADER),
    mod.Message(mod.stringkeys.SCOREBOARD_COLUMN3_HEADER),
    mod.Message(mod.stringkeys.SCOREBOARD_COLUMN4_HEADER),
    mod.Message(mod.stringkeys.SCOREBOARD_COLUMN5_HEADER)
  );
  mod.SetScoreboardHeader(
    mod.Message(mod.stringkeys.SCOREBOARD_TEAM1_NAME),
    mod.Message(mod.stringkeys.SCOREBOARD_TEAM2_NAME)
  );
  mod.SetScoreboardColumnWidths(250, 100, 100, 100, 250);
  mod.SetScoreboardSorting(1, false); // Sort by kills descending

  const allPlayers = mod.AllPlayers();
  for (let i = 0; i < mod.CountOf(allPlayers); i++) {
    const player: mod.Player = mod.ValueInArray(allPlayers, i);
    const playerId = mod.GetObjId(player);
    updateScoreboard(player, playersStats[playerId]);
  }
}

const updateScoreboard = (player: mod.Player, playerStats: PlayerStats) => {
  if (!playerStats) {
    return;
  }
  mod.SetScoreboardPlayerValues(
    player,
    (playerStats.k / (playerStats.d > 0 ? playerStats.d : 1)) * 1000, // K/D ratio, hacky since we can't have decimals
    playerStats.k,
    playerStats.d,
    playerStats.a,
    playerStats.k > 0 ? Math.floor((playerStats.hs / playerStats.k) * 100) : 0 // HS% calculation
  );
};

/* UI Helpers - Beginning Timer*/

function createBeginningTimer() {
  mod.AddUIContainer(
    UIWIDGET_TIMER_BEGINNING_ID,
    mod.CreateVector(0, -250, 0),
    mod.CreateVector(400, 200, 0),
    mod.UIAnchor.Center,
    mod.GetUIRoot(),
    true,
    0,
    mod.CreateVector(1, 1, 1),
    0.9,
    mod.UIBgFill.OutlineThin
  );
  const UITimerBeginningContainer = mod.FindUIWidgetWithName(
    UIWIDGET_TIMER_BEGINNING_ID
  );

  mod.AddUIText(
    UIWIDGET_TIMER_BEGINNING_TEXT_ID,
    mod.CreateVector(0, 0, 0),
    mod.CreateVector(300, 300, 0),
    mod.UIAnchor.Center,
    UITimerBeginningContainer,
    true,
    0,
    mod.CreateVector(0, 0, 0),
    0,
    mod.UIBgFill.None,
    mod.Message(
      mod.stringkeys.UISCORE_TIMER_BEGINNING,
      GAMEMODE_CONFIG.freezeTime,
      0
    ),
    120,
    mod.CreateVector(1, 1, 1),
    1,
    mod.UIAnchor.Center
  );
}

function updateBeginningTimer(
  remainingSeconds: number,
  remainingMilliseconds: number
) {
  const timerBeginningWidgetText = mod.FindUIWidgetWithName(
    UIWIDGET_TIMER_BEGINNING_TEXT_ID
  );

  if (timerBeginningWidgetText) {
    const message =
      remainingSeconds > 5
        ? mod.Message(mod.stringkeys.UISCORE_TIMER_BEGINNING, remainingSeconds)
        : mod.Message(
            mod.stringkeys.UISCORE_TIMER_BEGINNING_MS,
            remainingSeconds,
            remainingMilliseconds
          );

    mod.SetUITextLabel(timerBeginningWidgetText, message);
  }
}

function deleteTimerWidget() {
  const timerBeginningWidget = mod.FindUIWidgetWithName(
    UIWIDGET_TIMER_BEGINNING_ID
  );
  if (timerBeginningWidget) {
    mod.DeleteUIWidget(timerBeginningWidget);
  }
}

/* UI Helpers - Score */

function createUIScore() {
  mod.AddUIContainer(
    UIWIDGET_SCORE_CONTAINER_ID,
    mod.CreateVector(0, 52, 0),
    mod.CreateVector(200, 60, 0),
    mod.UIAnchor.TopCenter,
    mod.GetUIRoot(),
    true,
    0,
    mod.CreateVector(0.2, 0.2, 0.2),
    0.9,
    mod.UIBgFill.Blur
  );
  const UIScoreContainer = mod.FindUIWidgetWithName(
    UIWIDGET_SCORE_CONTAINER_ID
  );

  mod.AddUIText(
    UIWIDGET_SCORE_TIMER_ID,
    mod.CreateVector(0, 8, 0),
    mod.CreateVector(200, 10, 0),
    mod.UIAnchor.TopCenter,
    UIScoreContainer,
    true,
    0,
    mod.CreateVector(0, 0, 0),
    0,
    mod.UIBgFill.None,
    mod.Message(mod.stringkeys.UISCORE_SEPARATOR),
    14,
    mod.CreateVector(1, 1, 1),
    1,
    mod.UIAnchor.Center
  );

  mod.AddUIText(
    UIWIDGET_SCORE_TEAM1_SCORE_ID,
    mod.CreateVector(0, 0, 0),
    mod.CreateVector(100, 40, 0),
    mod.UIAnchor.CenterLeft,
    UIScoreContainer,
    true,
    0,
    mod.CreateVector(0, 0, 0),
    0,
    mod.UIBgFill.None,
    mod.Message(mod.stringkeys.UISCORE_POINTS, 0),
    20,
    mod.CreateVector(0.439, 0.922, 1),
    1,
    mod.UIAnchor.Center
  );
  mod.AddUIText(
    UIWIDGET_SCORE_TEAM1_NAME_ID,
    mod.CreateVector(0, 5, 0),
    mod.CreateVector(100, 10, 0),
    mod.UIAnchor.BottomLeft,
    UIScoreContainer,
    true,
    0,
    mod.CreateVector(0, 0, 0),
    0,
    mod.UIBgFill.None,
    mod.Message(mod.stringkeys.UISCORE_TEAM1_NAME),
    12,
    mod.CreateVector(0.439, 0.922, 1),
    1,
    mod.UIAnchor.Center
  );
  mod.AddUIText(
    UIWIDGET_SCORE_SEPARATOR_ID,
    mod.CreateVector(0, 10, 0),
    mod.CreateVector(200, 50, 0),
    mod.UIAnchor.TopCenter,
    UIScoreContainer,
    true,
    0,
    mod.CreateVector(0, 0, 0),
    0,
    mod.UIBgFill.None,
    mod.Message(mod.stringkeys.UISCORE_SEPARATOR),
    18,
    mod.CreateVector(1, 1, 1),
    1,
    mod.UIAnchor.Center
  );
  mod.AddUIText(
    UIWIDGET_SCORE_TEAM2_SCORE_ID,
    mod.CreateVector(0, 0, 0),
    mod.CreateVector(100, 40, 0),
    mod.UIAnchor.CenterRight,
    UIScoreContainer,
    true,
    0,
    mod.CreateVector(0, 0, 0),
    0,
    mod.UIBgFill.None,
    mod.Message(mod.stringkeys.UISCORE_POINTS, 0),
    20,
    mod.CreateVector(1, 0.514, 0.38),
    1,
    mod.UIAnchor.Center
  );
  mod.AddUIText(
    UIWIDGET_SCORE_TEAM2_NAME_ID,
    mod.CreateVector(0, 5, 0),
    mod.CreateVector(100, 10, 0),
    mod.UIAnchor.BottomRight,
    UIScoreContainer,
    true,
    0,
    mod.CreateVector(0, 0, 0),
    0,
    mod.UIBgFill.None,
    mod.Message(mod.stringkeys.UISCORE_TEAM2_NAME),
    12,
    mod.CreateVector(1, 0.514, 0.38),
    1,
    mod.UIAnchor.Center
  );
  mod.AddUIText(
    UIWIDGET_SCORE_FIRSTTO_ID,
    mod.CreateVector(0, 1, 0),
    mod.CreateVector(100, 10, 0),
    mod.UIAnchor.BottomCenter,
    UIScoreContainer,
    true,
    0,
    mod.CreateVector(0, 0, 0),
    0,
    mod.UIBgFill.None,
    mod.Message(mod.stringkeys.UISCORE_FIRSTTO, GAMEMODE_CONFIG.score),
    12,
    mod.CreateVector(1, 1, 1),
    1,
    mod.UIAnchor.BottomCenter
  );
}

function updateUIScore() {
  const team1Score = mod.GetGameModeScore(mod.GetTeam(GAMEMODE_CONFIG.team1ID));
  const team2Score = mod.GetGameModeScore(mod.GetTeam(GAMEMODE_CONFIG.team2ID));

  const team1UIScoreWidget = mod.FindUIWidgetWithName(
    UIWIDGET_SCORE_TEAM1_SCORE_ID
  );
  const team2UIScoreWidget = mod.FindUIWidgetWithName(
    UIWIDGET_SCORE_TEAM2_SCORE_ID
  );

  mod.SetUITextLabel(
    team1UIScoreWidget,
    mod.Message(mod.stringkeys.UISCORE_POINTS, team1Score)
  );
  mod.SetUITextLabel(
    team2UIScoreWidget,
    mod.Message(mod.stringkeys.UISCORE_POINTS, team2Score)
  );
}

function updateTimerText(
  remainingTime: number,
  remainingMinutes: number,
  remainingSeconds: number,
  remainingMilliseconds: number
) {
  const timerWidget = mod.FindUIWidgetWithName(UIWIDGET_SCORE_TIMER_ID);
  if (timerWidget) {
    if (remainingTime < 60) {
      mod.SetUITextColor(timerWidget, mod.CreateVector(0.9, 0, 0));
      mod.SetUITextLabel(
        timerWidget,
        mod.Message(
          mod.stringkeys.UISCORE_TIMER,
          remainingSeconds,
          remainingMilliseconds
        )
      );

      if (remainingSeconds <= 20 && tick % 30 === 0) {
        playSFX(mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Activate_OneShot2D);
      }
    } else {
      if (remainingTime < 120) {
        mod.SetUITextColor(timerWidget, mod.CreateVector(0.9, 0.9, 0));
      }

      mod.SetUITextLabel(
        timerWidget,
        mod.Message(
          remainingSeconds >= 10
            ? mod.stringkeys.UISCORE_TIMER
            : mod.stringkeys.UISCORE_TIMER_PADDED,
          remainingMinutes,
          remainingSeconds
        )
      );
    }
  }
}

function deleteUIScore() {
  const scoreContainerWidget = mod.FindUIWidgetWithName(
    UIWIDGET_SCORE_CONTAINER_ID
  );
  if (scoreContainerWidget) {
    mod.DeleteUIWidget(scoreContainerWidget);
  }
}

/* Game State custom functions */

async function endGame(winningTeam: mod.Team, losingTeam: mod.Team) {
  gameEnded = true;
  deleteUIScore();
  mod.EnableAllPlayerDeploy(false);
  await mod.Wait(5);
}

/* Event Handlers */

export async function OnGameModeStarted() {
  createSpawnPoints();
  createUIScore();
  createBeginningTimer();

  const team1HQ = mod.GetHQ(GAMEMODE_CONFIG.hqRoundStartTeam1);
  const team2HQ = mod.GetHQ(GAMEMODE_CONFIG.hqRoundStartTeam2);
  const team1HQGameStarted = mod.GetHQ(GAMEMODE_CONFIG.hqInProgressTeam1);
  const team2HQGameStarted = mod.GetHQ(GAMEMODE_CONFIG.hqInProgressTeam2);

  mod.EnableHQ(team1HQGameStarted, false);
  mod.EnableHQ(team2HQGameStarted, false);
  mod.SetGameModeTargetScore(GAMEMODE_CONFIG.score);
  mod.SetGameModeTimeLimit(GAMEMODE_CONFIG.timeLimit);
  createScoreboard();

  await mod.Wait(GAMEMODE_CONFIG.freezeTime);
  gameStarted = true;
  mod.EnableHQ(team1HQ, false);
  mod.EnableHQ(team2HQ, false);
  mod.EnableHQ(team1HQGameStarted, true);
  mod.EnableHQ(team2HQGameStarted, true);
  playVO(mod.VoiceOverEvents2D.RoundStartGeneric);

  deleteTimerWidget();
}

export function OnPlayerJoinGame(eventPlayer: mod.Player) {
  mod.SetRedeployTime(eventPlayer, 0);
  const playerId = mod.GetObjId(eventPlayer);
  playersStats[playerId] = {
    k: 0,
    d: 0,
    a: 0,
    hs: 0,
  };
  updateScoreboard(eventPlayer, playersStats[playerId]);
}

export function OnPlayerDeployed(eventPlayer: mod.Player) {
  if (GAMEMODE_CONFIG.maxStartingAmmo) {
    mod.SetInventoryMagazineAmmo(
      eventPlayer,
      mod.InventorySlots.PrimaryWeapon,
      9999
    );
    mod.SetInventoryMagazineAmmo(
      eventPlayer,
      mod.InventorySlots.SecondaryWeapon,
      9999
    );
  }
}

export function OnPlayerEnterAreaTrigger(
  eventPlayer: mod.Player,
  eventAreaTrigger: mod.AreaTrigger
) {
  if (mod.GetObjId(eventAreaTrigger) === GAMEMODE_CONFIG.respawnAreaTriggerID) {
    // The HQ is surrounded by the zone, teleporting any players to the furthest point available
    mod.Teleport(eventPlayer, getFurthestSpawnPointFromEnemies(eventPlayer), 0);
  }
}

export function OnPlayerLeaveGame(eventNumber: number) {
  delete playersStats[eventNumber];
}

export function OnPlayerEarnedKill(
  eventPlayer: mod.Player,
  eventOtherPlayer: mod.Player,
  eventDeathType: mod.DeathType,
  eventWeaponUnlock: mod.WeaponUnlock
) {
  if (
    mod.EventDeathTypeCompare(eventDeathType, mod.PlayerDeathTypes.Deserting) ||
    mod.EventDeathTypeCompare(eventDeathType, mod.PlayerDeathTypes.Drowning) ||
    mod.EventDeathTypeCompare(eventDeathType, mod.PlayerDeathTypes.Redeploy) ||
    mod.Equals(eventPlayer, eventOtherPlayer)
  ) {
    return;
  }
  const playerId = mod.GetObjId(eventPlayer);
  const playerTeam = mod.GetTeam(eventPlayer);
  const otherPlayerTeam = mod.GetTeam(eventOtherPlayer);

  playersStats[playerId].k++;
  playersStats[playerId].hs += mod.EventDeathTypeCompare(
    eventDeathType,
    mod.PlayerDeathTypes.Headshot
  )
    ? 1
    : 0;

  mod.SetGameModeScore(playerTeam, mod.GetGameModeScore(playerTeam) + 1);
  updateScoreboard(eventPlayer, playersStats[playerId]);
  updateUIScore();
  if (mod.GetGameModeScore(playerTeam) >= GAMEMODE_CONFIG.score) {
    // because the gamemode end doesn't actually end at the score, we have to trigger that "manually"
    endGame(playerTeam, otherPlayerTeam);
  } else {
    playProgressSFX(playerTeam, otherPlayerTeam);
  }
}

export function OnPlayerEarnedKillAssist(
  eventPlayer: mod.Player,
  eventOtherPlayer: mod.Player
) {
  const playerId = mod.GetObjId(eventPlayer);
  playersStats[playerId].a++;
  updateScoreboard(eventPlayer, playersStats[playerId]);
}

export function OnPlayerUndeploy(eventPlayer: mod.Player) {
  const eventPlayerId = mod.GetObjId(eventPlayer);
  playersStats[eventPlayerId].d++;
  updateScoreboard(eventPlayer, playersStats[eventPlayerId]);
}

/* Loop Handlers */

export function OngoingPlayer(eventPlayer: mod.Player) {
  if (
    (!gameStarted || gameEnded) &&
    !mod.GetSoldierState(eventPlayer, mod.SoldierStateBool.IsDead)
  ) {
    mod.EnableAllInputRestrictions(eventPlayer, true);
  } else {
    mod.EnableAllInputRestrictions(eventPlayer, false);
  }
}

export function OngoingGlobal() {
  tick++; // ONLY increment tick here
  const remainingTime = Math.floor(mod.GetMatchTimeRemaining());
  const remainingMinutes = Math.floor(remainingTime / 60);
  const remainingSeconds = remainingTime % 60;
  const remainingMilliseconds = Math.floor(
    1000 - (tick % 30) * 30 + Math.floor(Math.random() * 10)
  ); // using ticks because ms aren't updated on remaining time, which is why we also use math.round (ms are static in the fn return so useless)

  if (!gameStarted) {
    updateBeginningTimer(remainingSeconds, remainingMilliseconds);
  }

  if (remainingTime < 120 && !hasPlayedTime120LeftVO) {
    playVO(mod.VoiceOverEvents2D.Time120Left);
    hasPlayedTime120LeftVO = true;
  } else if (remainingTime < 60 && !hasPlayedTime60LeftVO) {
    playVO(mod.VoiceOverEvents2D.Time60Left);
    hasPlayedTime60LeftVO = true;
  } else if (remainingTime < 30 && !hasPlayedTime30LeftVO) {
    playVO(mod.VoiceOverEvents2D.Time30Left);
    hasPlayedTime30LeftVO = true;
  } else if (remainingTime === 0 && tick % 30 >= 28) {
    endGame(
      mod.GetTeam(GAMEMODE_CONFIG.team1ID),
      mod.GetTeam(GAMEMODE_CONFIG.team2ID)
    );
  }

  updateTimerText(
    remainingTime,
    remainingMinutes,
    remainingSeconds,
    remainingMilliseconds
  );
}
