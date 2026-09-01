import { Command } from 'nest-commander';

import { isDefined } from 'twenty-shared/utils';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { STANDARD_NAVIGATION_MENU_ITEMS } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-navigation-menu-item.constant';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const FOLLOW_UPS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER =
  STANDARD_NAVIGATION_MENU_ITEMS.followUps.universalIdentifier;

@RegisteredWorkspaceCommand('2.33.0', 1787600001000)
@Command({
  name: 'upgrade:2-33:add-follow-ups-navigation-menu-item',
  description:
    'Add the Follow-ups navigation menu item to existing workspaces so the follow-up queue is reachable from the navigation drawer',
})
export class AddFollowUpsNavigationMenuItemCommand extends ProvisionedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const isDryRun = options.dryRun ?? false;

    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    const { flatNavigationMenuItemMaps: existingFlatNavigationMenuItemMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatNavigationMenuItemMaps',
      ]);

    if (
      isDefined(
        existingFlatNavigationMenuItemMaps.byUniversalIdentifier[
          FOLLOW_UPS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER
        ],
      )
    ) {
      this.logger.log(
        `Follow-ups navigation menu item already exists for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });

    const itemToCreate =
      standardAllFlatEntityMaps.flatNavigationMenuItemMaps.byUniversalIdentifier[
        FOLLOW_UPS_NAVIGATION_MENU_ITEM_UNIVERSAL_IDENTIFIER
      ];

    if (!isDefined(itemToCreate)) {
      throw new Error(
        `Follow-ups navigation menu item is missing from the standard application definition`,
      );
    }

    this.logger.log(
      `${isDryRun ? '[DRY RUN] ' : ''}Adding the Follow-ups navigation menu item for workspace ${workspaceId}`,
    );

    if (isDryRun) {
      return;
    }

    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunLegacyWorkspaceMigration(
        {
          isSystemBuild: true,
          allFlatEntityOperationByMetadataName: {
            navigationMenuItem: {
              flatEntityToCreate: [itemToCreate],
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
          },
          workspaceId,
          applicationUniversalIdentifier:
            twentyStandardFlatApplication.universalIdentifier,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      throw new Error(
        `Failed to add the Follow-ups navigation menu item for workspace ${workspaceId}: ${JSON.stringify(
          validateAndBuildResult,
          null,
          2,
        )}`,
      );
    }

    this.logger.log(
      `Added the Follow-ups navigation menu item for workspace ${workspaceId}`,
    );
  }
}
