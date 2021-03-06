import {inject, injectable} from "inversify";
import {Settings} from "../../bll/entities/settings";
import {GitIsActiveValidator} from "../../bll/cvsutils/gitisactivevalidator";
import {GitPathFinder} from "../../bll/cvsutils/gitpathfinder";
import {GitProvider} from "../gitprovider";
import {TYPES} from "../../bll/utils/constants";
import {Logger} from "../../bll/utils/logger";
import {Utils} from "../../bll/utils/utils";
import {UriProxy} from "../../bll/moduleproxies/uri-proxy";
import {Uri} from "vscode";
import {GitCommandsFactory} from "./GitCommandsFactory";

@injectable()
export class GitProviderActivator {

    public constructor(@inject(TYPES.Settings) private readonly settings: Settings,
                       @inject(TYPES.GitIsActiveValidator) private readonly isActiveValidator: GitIsActiveValidator,
                       @inject(TYPES.GitPathFinder) private readonly pathFinder: GitPathFinder,
                       @inject(TYPES.GitCommandsFactory) private readonly gitCommandsFactory: GitCommandsFactory) {
        //
    }

    public async tryActivateInPath(workspaceRootPath: UriProxy | Uri): Promise<GitProvider> | undefined {
        try {
            const gitPath: string = await this.pathFinder.find();
            await this.isActiveValidator.validate(workspaceRootPath.fsPath, gitPath);
            return new GitProvider(workspaceRootPath, gitPath, this.gitCommandsFactory);
        } catch (err) {
            Logger.logDebug(Utils.formatErrorMessage(err));
            return undefined;
        }

    }
}
