//#region Types

interface TeamSwitchConfig {
  enableTeamSwitch: boolean;
  interactPointMinLifetime: number;
  interactPointMaxLifetime: number;
  velocityThreshold: number;
}

interface teamSwitchData {
  interactPoint: mod.InteractPoint | null;
  lastDeployTime: number;
  dontShowAgain: boolean;
}

//#endregion

//#region Config

const TEAMSWITCHCONFIG: TeamSwitchConfig = {
  enableTeamSwitch: true,
  interactPointMinLifetime: 1,
  interactPointMaxLifetime: 3,
  velocityThreshold: 3
}

const teamSwitchData: { [id: number]: teamSwitchData } = {};

//#endregion

//#region Team Switch Logic

/**
 * Spawns an interact point in front of the player when they deploy
 * The interact point allows players to switch teams
 */
async function spawnTeamSwitchInteractPoint(eventPlayer: mod.Player) {
  let playerId = mod.GetObjId(eventPlayer);
  if (teamSwitchData[playerId].interactPoint === null) {
    let interactPointPosition = mod.CreateVector(0, 0, 0);
    let isOnGround = mod.GetSoldierState(
      eventPlayer,
      mod.SoldierStateBool.IsOnGround
    );

    // Wait for player to be on the ground to avoid velocity issues
    while (!isOnGround) {
      await mod.Wait(0.2)
      isOnGround = mod.GetSoldierState(
        eventPlayer,
        mod.SoldierStateBool.IsOnGround
      );
    }

    let playerPosition = mod.GetSoldierState(
      eventPlayer,
      mod.SoldierStateVector.GetPosition
    );
    let playerFacingDirection = mod.GetSoldierState(
      eventPlayer,
      mod.SoldierStateVector.GetFacingDirection
    );

    // Position the interact point in front of the player
    interactPointPosition = mod.Add(
      mod.Add(
        playerPosition,
        playerFacingDirection
      ),
      mod.CreateVector(0, 1.5, 0)
    );

    let interactPoint: mod.InteractPoint = mod.SpawnObject(
      mod.RuntimeSpawn_Common.InteractPoint,
      interactPointPosition,
      mod.CreateVector(0, 0, 0)
    );
    mod.EnableInteractPoint(interactPoint, true);
    teamSwitchData[playerId].interactPoint = interactPoint;
    teamSwitchData[playerId].lastDeployTime = mod.GetMatchTimeElapsed();
  }
}

/**
 * Processes the team switch when the interact point is activated
 */
function teamSwitchInteractPointActivated(eventPlayer: mod.Player, eventInteractPoint: mod.InteractPoint) {
  let playerId = mod.GetObjId(eventPlayer);
  if (teamSwitchData[playerId].interactPoint != null) {
    let interactPointId = mod.GetObjId(teamSwitchData[playerId].interactPoint)
    let eventInteractPointId = mod.GetObjId(eventInteractPoint);
    if (interactPointId == eventInteractPointId) {
      mod.EnableUIInputMode(true, eventPlayer);
      createTeamSwitchUI(eventPlayer);
      // Switch to opposite team
      mod.DisplayNotificationMessage(mod.Message(mod.stringkeys.NOTIFICATION_TEAM_SWITCH), eventPlayer);
      mod.SetTeam(eventPlayer, mod.Equals(mod.GetTeam(eventPlayer), mod.GetTeam(2)) ? mod.GetTeam(1) : mod.GetTeam(2));
      mod.UndeployPlayer(eventPlayer);
      removeTeamSwitchInteractPoint(playerId);
    }
  }
}

/**
 * Removes the interact point for the specified player
 */
function removeTeamSwitchInteractPoint(playerId: number) {
  if (teamSwitchData[playerId].interactPoint != null) {
    mod.EnableInteractPoint(teamSwitchData[playerId].interactPoint, false);
    mod.UnspawnObject(teamSwitchData[playerId].interactPoint);
    teamSwitchData[playerId].interactPoint = null;
  }
}

/**
 * Checks if a player's velocity exceeds the threshold
 */
function isVelocityBeyond(threshold: number, eventPlayer: mod.Player): boolean {
  let playerVelocity = mod.GetSoldierState(eventPlayer, mod.SoldierStateVector.GetLinearVelocity);
  let x = mod.AbsoluteValue(mod.XComponentOf(playerVelocity));
  let y = mod.AbsoluteValue(mod.YComponentOf(playerVelocity));
  let z = mod.AbsoluteValue(mod.ZComponentOf(playerVelocity));
  let playerVelocityNumber = x + y + z;
  return playerVelocityNumber > threshold ? true : false;
}

/**
 * Checks and removes the interact point if the player is moving or hasn't interacted for too long
 */
function checkTeamSwitchInteractPointRemoval(eventPlayer: mod.Player) {
  if (TEAMSWITCHCONFIG.enableTeamSwitch && !mod.GetSoldierState(eventPlayer, mod.SoldierStateBool.IsDead)) {
    let playerId = mod.GetObjId(eventPlayer);
    if (teamSwitchData[playerId].interactPoint != null) {
      // Remove interact point if player is moving or did not interact within threshold
      let interactPointLifetime = (mod.GetMatchTimeElapsed() - teamSwitchData[playerId].lastDeployTime)
      if (isVelocityBeyond(TEAMSWITCHCONFIG.velocityThreshold, eventPlayer) ||
        (interactPointLifetime > TEAMSWITCHCONFIG.interactPointMaxLifetime)) {
        removeTeamSwitchInteractPoint(playerId);
      }
    }
  }
}

function initTeamSwitchData(eventPlayer: mod.Player) {
  const playerId = mod.GetObjId(eventPlayer);
  teamSwitchData[playerId] = {
    dontShowAgain: false,
    interactPoint: null,
    lastDeployTime: 0
  };
}

//#endregion

//#region Team Switch UI


function createTeamSwitchUI(eventPlayer: mod.Player) {
  let playerId = mod.GetObjId(eventPlayer);
  const UI_TEAMSWITCH_CONTAINER_BASE_ID = "UI_TEAMSWITCH_CONTAINER_BASE_" + playerId;
  const UI_TEAMSWITCH_BUTTON_TEAM1_ID = "UI_TEAMSWITCH_BUTTON_TEAM1_" + playerId;
  const UI_TEAMSWITCH_BUTTON_TEAM1_LABEL_ID = "UI_TEAMSWITCH_BUTTON_TEAM1_LABEL_" + playerId;
  const UI_TEAMSWITCH_BUTTON_TEAM2_ID = "UI_TEAMSWITCH_BUTTON_TEAM2_" + playerId;

  mod.AddUIContainer(UI_TEAMSWITCH_CONTAINER_BASE_ID, mod.CreateVector(0, 0, 0), mod.CreateVector(1300, 700, 0), mod.UIAnchor.Center, mod.GetUIRoot(), true, 10, mod.CreateVector(0, 0, 0), 1, mod.UIBgFill.Blur, eventPlayer);
  const UI_TEAMSWITCH_CONTAINER_BASE = mod.FindUIWidgetWithName(UI_TEAMSWITCH_CONTAINER_BASE_ID, mod.GetUIRoot());
  mod.AddUIButton(UI_TEAMSWITCH_BUTTON_TEAM1_ID, mod.CreateVector(0, 0, 0), mod.CreateVector(300, 100, 0), mod.UIAnchor.CenterLeft);
  const UI_TEAMSWITCH_BUTTON_TEAM1 = mod.FindUIWidgetWithName(UI_TEAMSWITCH_BUTTON_TEAM1_ID, mod.GetUIRoot());
  mod.SetUIWidgetParent(UI_TEAMSWITCH_BUTTON_TEAM1, UI_TEAMSWITCH_CONTAINER_BASE);
  mod.AddUIText(UI_TEAMSWITCH_BUTTON_TEAM1_LABEL_ID, mod.CreateVector(0, 0, 0), mod.CreateVector(250, 50, 0), mod.UIAnchor.CenterLeft, mod.Message(mod.stringkeys.UI_TEAMSWITCH_BUTTON_TEAM1_LABEL));
  const UI_TEAMSWITCH_BUTTON_TEAM1_LABEL = mod.FindUIWidgetWithName(UI_TEAMSWITCH_BUTTON_TEAM1_LABEL_ID, mod.GetUIRoot());
  mod.SetUIWidgetParent(UI_TEAMSWITCH_BUTTON_TEAM1_LABEL, UI_TEAMSWITCH_BUTTON_TEAM1);
}

//#endregion

//#region Event Handlers

/**
 * Initialize team switch settings for newly joined players
 */
export function OnPlayerJoinGame(eventPlayer: mod.Player) {
  initTeamSwitchData(eventPlayer);
}

/**
 * Spawn the team switch interact point when player deploys
 */
export async function OnPlayerDeployed(eventPlayer: mod.Player) {
  await spawnTeamSwitchInteractPoint(eventPlayer);
}

/**
 * Clean up when player leaves the game
 */
export function OnPlayerLeaveGame(eventNumber: number) {
  removeTeamSwitchInteractPoint(eventNumber);
}

/**
 * Clean up when player undeployss
 */
export function OnPlayerUndeploy(eventPlayer: mod.Player) {
  const playerId = mod.GetObjId(eventPlayer);
  removeTeamSwitchInteractPoint(playerId);
}

/**
 * Ongoing check for interact point removal based on player movement
 */
export function OngoingPlayer(eventPlayer: mod.Player) {
  checkTeamSwitchInteractPointRemoval(eventPlayer);
}

/**
 * Handles the interaction event when player interacts with the team switch point
 */
export function OnPlayerInteract(eventPlayer: mod.Player, eventInteractPoint: mod.InteractPoint) {
  teamSwitchInteractPointActivated(eventPlayer, eventInteractPoint);
}

//#endregion
