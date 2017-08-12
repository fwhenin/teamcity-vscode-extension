"use strict";
import { PatchSender } from "../remoterun/patchsender";
import { XmlRpcProvider } from "../utils/xmlrpcprovider";
import { FileController } from "../utils/filecontroller";
import { ByteWriter } from "../utils/bytewriter";
import { VsCodeUtils } from "../utils/vscodeutils";
import { Constants, ChangeListStatus, CvsFileStatusCode } from "../utils/constants";
import { Credential } from "../credentialstore/credential";
import { BuildConfigItem } from "../remoterun/configexplorer";
import { CvsSupportProvider } from "../remoterun/cvsprovider";
import { CheckinInfo, MappingFileContent, RestHeader, QueuedBuild, CvsLocalResource } from "../utils/interfaces";
import { NotificationWatcher } from "../notifications/notificationwatcher";
import { AsyncWriteStream } from "../utils/writestream";
import * as path from "path";
import * as fs from "fs";
import * as xml2js from "xml2js";
import * as request from "request";

export class CustomPatchSender extends XmlRpcProvider implements PatchSender {
    private readonly CHECK_FREQUENCY_MS : number = 10000;
    /**
     * @returns true in case of success, otherwise false.
     */
    public async remoteRun(creds: Credential, configs: BuildConfigItem[], cvsProvider: CvsSupportProvider): Promise<boolean> {
        //We might not have userId at the moment
        if (!creds.userId) {
            await this.authenticateIfRequired(creds);
        }
        const patchAbsPath : string = await this.preparePatch(cvsProvider);

        const checkInInfo : CheckinInfo = await cvsProvider.getRequiredCheckinInfo();
        const patchDestinationUrl : string = `${creds.serverURL}/uploadChanges.html?userId=${creds.userId}&description="${checkInInfo.message}"&commitType=0`;
        try {
            const prom : Promise<string> = new Promise((resolve, reject) => {
                fs.createReadStream(patchAbsPath).pipe(request.post(patchDestinationUrl, (err, httpResponse, body) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(body);
                }).auth(creds.user, creds.pass, false));
            });
            const changeListId = await prom;
            //We should remove patchFile
            FileController.removeFileAsync(patchAbsPath);
            const queuedBuilds : QueuedBuild[] = await this.triggerChangeList(changeListId, configs, creds);
            const changeListStatus : ChangeListStatus = await this.getChangeListStatus(creds, queuedBuilds);
            if (changeListStatus === ChangeListStatus.CHECKED) {
                VsCodeUtils.showInfoMessage(`Personal build for change #${changeListId} has "CHECKED" status.`);
                return true;
            } else {
                VsCodeUtils.showWarningMessage(`Personal build for change #${changeListId} has "FAILED" status.`);
                return false;
            }
        } catch (err) {
            console.log(VsCodeUtils.formatErrorMessage(err));
            return false;
        }
    }

    /**
     * This method uses PatchBuilder to write all required info into the patch file
     * @param cvsProvider - CvsProvider object
     * @return Promise<string> - absPath of the patch
     */
    private async preparePatch(cvsProvider : CvsSupportProvider) : Promise<string> {
        const checkInInfo : CheckinInfo = await cvsProvider.getRequiredCheckinInfo();
        const changedFilesNames : CvsLocalResource[] = checkInInfo.cvsLocalResources;
        if (!changedFilesNames) {
            return;
        }
        const configFileContent : MappingFileContent = await cvsProvider.generateMappingFileContent();
        const patchBuilder : PatchBuilder = new PatchBuilder();

        //It's impossible to use forEach loop with await calls
        for (let i : number = 0; i < changedFilesNames.length; i++) {
            const absPath : string = changedFilesNames[i].fileAbsPath;
            const status : CvsFileStatusCode = changedFilesNames[i].status;
            const relPath : string = path.relative(configFileContent.localRootPath, absPath).replace(/\\/g, "/");
            const fileExist : boolean = await FileController.exists(absPath);
            const teamcityFileName : string = `${configFileContent.tcProjectRootPath}/${relPath}`;
            switch (status) {
                //TODO: Implement replaced status code
                case CvsFileStatusCode.ADDED : {
                    if (fileExist) {
                        await patchBuilder.addAddedFile(teamcityFileName, absPath);
                    } //TODO: add logs if not
                    break;
                }
                case CvsFileStatusCode.DELETED : {
                    await patchBuilder.addDeletedFile(teamcityFileName);
                    break;
                }
                case CvsFileStatusCode.MODIFIED : {
                    if (fileExist) {
                        await patchBuilder.addReplacedFile(teamcityFileName, absPath);
                    } //TODO: add logs if not
                    break;
                }
                default : {
                    if (fileExist) {
                        await patchBuilder.addReplacedFile(teamcityFileName, absPath);
                    } else {
                        await patchBuilder.addDeletedFile(teamcityFileName);
                    }
                    break;
                }
            }
        }
        return patchBuilder.getPatchName();
    }

    /**
     * @param changeListId - id of change list to trigger
     * @param buildConfigs - all build configs, which should be triggered
     * @param creds - user credentials
     */
    public async triggerChangeList( changeListId : string,
                                    buildConfigs : BuildConfigItem[],
                                    creds : Credential) : Promise<QueuedBuild[]> {
        if (!buildConfigs) {
            return [];
        }
        const queuedBuilds : QueuedBuild[] = [];
        for (let i = 0; i < buildConfigs.length; i++) {
            const build : BuildConfigItem = buildConfigs[i];
            const url : string = `${creds.serverURL}/app/rest/buildQueue`;
            const data = `
                <build personal="true">
                    <triggeringOptions cleanSources="false" rebuildAllDependencies="false" queueAtTop="false"/>
                    <buildType id="${build.externalId}"/>
                    <lastChanges>
                        <change id="${changeListId}" personal="true"/>
                    </lastChanges>
                </build>`;
            const additionalArgs : string[] = undefined;
            const additionalHeaders : RestHeader[] = [];
            additionalHeaders.push({
                header: "Content-Type",
                value: "application/xml"
            });
            const queuedBuildInfoXml : string = await VsCodeUtils.makeRequest(Constants.POST_METHOD, url, creds, data, additionalArgs, additionalHeaders);
            xml2js.parseString(queuedBuildInfoXml, (err, queuedBuildInfo) => {
                queuedBuilds.push(queuedBuildInfo.build.$);
            });
        }
        return queuedBuilds;
    }

    private async getChangeListStatus(creds: Credential, queuedBuilds: QueuedBuild[]): Promise<ChangeListStatus> {
        if (!queuedBuilds) {
            return ChangeListStatus.CHECKED;
        }
        const buildStatuses : string[] = [];
        let i : number = 0;
        while (i < queuedBuilds.length) {
            const build : QueuedBuild = queuedBuilds[i];
            const url = `${creds.serverURL}/app/rest/buildQueue/${build.id}`;
            const buildInfoXml : string = await VsCodeUtils.makeRequest(Constants.GET_METHOD, url, creds);
            const prom : Promise<string> = new Promise((resolve, reject) => {
                xml2js.parseString(buildInfoXml, (err, buildInfo) => {
                    if (err
                        || !buildInfo
                        || !buildInfo.build
                        || !buildInfo.build.$
                        || !buildInfo.build.$.state
                        || !buildInfo.build.$.status
                        || buildInfo.build.$.state !== "finished") {
                        resolve(undefined);
                    }
                    resolve(buildInfo.build.$.status);
                });
            });
            const buildStatus : string = await prom;
            if (!buildStatus) {
                VsCodeUtils.sleep(this.CHECK_FREQUENCY_MS);
            } else {
                buildStatuses.push(buildStatus);
                i++;
            }
        }

        for (let i : number = 0; i < buildStatuses.length; i++) {
            const status : string = buildStatuses[i];
            if (status !== "SUCCESS") {
                return ChangeListStatus.FAILED;
            }
        }
        return ChangeListStatus.CHECKED;
    }
}

/**
 * Private class to build a patch from checkin info
 */
class PatchBuilder {
    private readonly _bufferArray : Buffer[];
    private static readonly DELETE_PREFIX : number = 3;
    private static readonly END_OF_PATCH_MARK : number = 10;
    private static readonly RENAME_PREFIX : number = 19;
    private static readonly REPLACE_PREFIX : number = 25;
    private static readonly CREATE_PREFIX : number = 26;
    private readonly _writeSteam : AsyncWriteStream;
    private readonly _patchAbsPath : string;

    constructor() {
        this._bufferArray = [];
        const patchAbsPath : string = path.join(__dirname, "..", "..", "..", "resources", `.${VsCodeUtils.uuidv4()}.patch`);
        this._patchAbsPath = patchAbsPath;
        this._writeSteam = new AsyncWriteStream(patchAbsPath);
    }

        /**
     * This method adds to the patch a new file
     * @param tcFileName - fileName at the TeamCity format
     * @param absLocalPath - absolute path to the file in the system
     */
    public async addAddedFile(tcFileName: string, absLocalPath : string) : Promise<void> {
        return this.addFile(tcFileName, absLocalPath, PatchBuilder.CREATE_PREFIX);
    }

    /**
     * This method adds to the patch an edited file
     * @param tcFileName - fileName at the TeamCity format
     * @param absLocalPath - absolute path to the file in the system
     */
    public async addReplacedFile(tcFileName: string, absLocalPath : string) : Promise<void> {
        return this.addFile(tcFileName, absLocalPath, PatchBuilder.REPLACE_PREFIX);
    }

    /**
     * This method adds to the patch any not deleted file
     * @param tcFileName - fileName at the TeamCity format
     * @param absLocalPath - absolute path to the file in the system
     * @param prefix - prefix which specifies the operation, eg. CREATE/REPLACE
     */
    private async addFile(tcFileName: string, absLocalPath : string, prefix : number) : Promise<void> {
        try {
            const bytePrefix : Buffer = ByteWriter.writeByte(prefix);
            const byteFileName : Buffer = ByteWriter.writeUTF(tcFileName);
            await this._writeSteam.write(Buffer.concat([bytePrefix, byteFileName]));
            await this._writeSteam.writeFile(absLocalPath);
        } catch (err) {
            //TODO: WRITE TO THE LOG SMT SCARY
        }
    }

    /**
     * This method adds to the patch a deleted file
     * @param tcFileName - fileName at the TeamCity format
     */
    public async addDeletedFile(tcFileName: string) {
        try {
            const bytePrefix : Buffer = ByteWriter.writeByte(PatchBuilder.DELETE_PREFIX);
            const byteFileName : Buffer = ByteWriter.writeUTF(tcFileName);
            await this._writeSteam.write(Buffer.concat([bytePrefix, byteFileName]));
        } catch (err) {
            //TODO: WRITE TO THE LOG SMT SCARY
        }
    }

    /**
     * The final stage of a patch building - add eof mark and return all the patch content as Buffer object
     */
    public async getPatchName() : Promise<string> {
        const byteEOPMark : Buffer = ByteWriter.writeByte(PatchBuilder.END_OF_PATCH_MARK);
        const byteEmptyLine : Buffer = ByteWriter.writeUTF("");
        await this._writeSteam.write(Buffer.concat([byteEOPMark, byteEmptyLine]));
        this._writeSteam.dispose();
        return this._patchAbsPath;
    }
}