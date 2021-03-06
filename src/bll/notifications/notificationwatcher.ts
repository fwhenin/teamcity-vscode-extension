import {Disposable} from "vscode";
import {TeamCityOutput} from "../../view/teamcityoutput";
import {CredentialsStore} from "../credentialsstore/credentialsstore";

export interface NotificationWatcher extends Disposable {
    activate(): Promise<void>;
}
