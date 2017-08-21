"use strict";

import {PatchSender} from "../interfaces/PatchSender";
import {Credentials} from "../credentialsstore/credentials";
import {BuildConfigItem} from "../entities/buildconfigitem";
import {CvsSupportProvider} from "../interfaces/cvsprovider";
import {PatchManager} from "../utils/patchmanager";
import {CheckInInfo} from "../interfaces/checkininfo";
import {QueuedBuild} from "../interfaces/queuedbuild";
import {ChangeListStatus} from "../utils/constants";
import {VsCodeUtils} from "../utils/vscodeutils";
import {Logger} from "../utils/logger";
import {IWebLinks} from "../dal/iweblinks";
import {WebLinks} from "../dal/weblinks";
import {XmlParser} from "../bll/xmlparser";

export class CustomPatchSender implements PatchSender {
    private readonly CHECK_FREQUENCY_MS: number = 10000;
    private readonly _webLinks : IWebLinks;

    constructor(credentials : Credentials) {
        this._webLinks = new WebLinks(credentials);
    }

    /**
     * @returns true in case of success, otherwise false.
     */
    public async remoteRun(configs: BuildConfigItem[], cvsProvider: CvsSupportProvider): Promise<boolean> {
        const patchAbsPath: string = await PatchManager.preparePatch(cvsProvider);
        const checkInInfo: CheckInInfo = await cvsProvider.getRequiredCheckInInfo();
        try {
            const changeListId = await this._webLinks.uploadChanges(patchAbsPath, checkInInfo.message);
            //We should not remove patchFile because it will be deleted as file inside a temp folder
            const queuedBuilds: QueuedBuild[] = await this.triggerChangeList(changeListId, configs);
            const changeListStatus: ChangeListStatus = await this.getChangeListStatus(queuedBuilds);
            if (changeListStatus === ChangeListStatus.CHECKED) {
                VsCodeUtils.showInfoMessage(`Personal build for change #${changeListId} has "CHECKED" status.`);
                return true;
            } else {
                VsCodeUtils.showWarningMessage(`Personal build for change #${changeListId} has "FAILED" status.`);
                return false;
            }
        } catch (err) {
            Logger.logError(VsCodeUtils.formatErrorMessage(err));
            return false;
        }
    }

    /**
     * @param changeListId - id of change list to trigger
     * @param buildConfigs - all build configs, which should be triggered
     */
    public async triggerChangeList(changeListId: string,
                                   buildConfigs: BuildConfigItem[]): Promise<QueuedBuild[]> {
        if (!buildConfigs) {
            return [];
        }
        const queuedBuilds: QueuedBuild[] = [];
        for (let i = 0; i < buildConfigs.length; i++) {
            const build: BuildConfigItem = buildConfigs[i];
            const queuedBuildInfoXml: string = await this._webLinks.buildQueue(changeListId, build);
            queuedBuilds.push(await XmlParser.parseQueuedBuild(queuedBuildInfoXml));
        }
        return queuedBuilds;
    }

    private async getChangeListStatus(queuedBuilds: QueuedBuild[]): Promise<ChangeListStatus> {
        if (!queuedBuilds) {
            return ChangeListStatus.CHECKED;
        }
        const buildStatuses: string[] = [];
        let i: number = 0;
        while (i < queuedBuilds.length) {
            const build: QueuedBuild = queuedBuilds[i];
            const buildInfoXml: string = await this._webLinks.getBuildInfo(build);
            const buildStatus: string = await XmlParser.parseBuildStatus(buildInfoXml);
            if (!buildStatus) {
                await VsCodeUtils.sleep(this.CHECK_FREQUENCY_MS);
            } else {
                buildStatuses.push(buildStatus);
                i++;
            }
        }

        for (let i: number = 0; i < buildStatuses.length; i++) {
            const status: string = buildStatuses[i];
            if (status !== "SUCCESS") {
                return ChangeListStatus.FAILED;
            }
        }
        return ChangeListStatus.CHECKED;
    }
}
