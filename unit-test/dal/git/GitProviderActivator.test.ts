import "reflect-metadata";
const rmock = require("mock-require");
rmock("vscode", { });

import {GitProviderActivator} from "../../../src/dal/git/GitProviderActivator";
import {GitPathFinder} from "../../../src/bll/cvsutils/gitpathfinder";
import {GitIsActiveValidator} from "../../../src/bll/cvsutils/gitisactivevalidator";
import {anyFunction, anything, instance, mock, when} from "ts-mockito";
import {UriProxy} from "../../../src/bll/moduleproxies/uri-proxy";
import * as assert from "assert";
import {GitCommandsFactory} from "../../../src/dal/git/GitCommandsFactory";

suite("GitProviderActivator", () => {

    const fakeUri: UriProxy = {fsPath: "fsPath", path: "path", file: anyFunction};

    const isActiveValidatorMock = mock(GitIsActiveValidator);
    when(isActiveValidatorMock.validate(anything(), anything())).thenReturn();
    const isActiveValidatorSpy = instance(isActiveValidatorMock);

    const pathFinderMock = mock(GitPathFinder);
    when(pathFinderMock.find()).thenReturn(Promise.resolve("git"));
    const pathFinderSpy = instance(pathFinderMock);

    const gitCommandsFactoryMock = mock(GitCommandsFactory);
    const gitCommandsFactory = instance(gitCommandsFactoryMock);

    test("should verify git is not installed", function (done) {
        when(pathFinderMock.find()).thenReject("error");
        when(isActiveValidatorMock.validate(anything(), anything())).thenReturn();

        const activator = new GitProviderActivator(anything(), isActiveValidatorSpy, pathFinderSpy, gitCommandsFactory);
        activator.tryActivateInPath(fakeUri).catch((err) => {
           done("Unexpected exception: " + err);
        }).then((result) => {
            assert.equal(result, undefined);
            done();
        });
    });

    test("should verify git is installed", function (done) {
        when(pathFinderMock.find()).thenReturn(Promise.resolve("git"));
        when(isActiveValidatorMock.validate(anything(), anything())).thenReturn();

        const activator = new GitProviderActivator(anything(), isActiveValidatorSpy, pathFinderSpy, gitCommandsFactory);

        activator.tryActivateInPath(fakeUri).catch((err) => {
            done("Unexpected exception: " + err);
        }).then((result) => {
            assert.notEqual(result, undefined);
            done();
        });
    });

    test("should verify activation is failed", function (done) {
        when(pathFinderMock.find()).thenReturn(Promise.resolve("git"));
        when(isActiveValidatorMock.validate(anything(), anything())).thenReject("error");
        const activator = new GitProviderActivator(anything(), isActiveValidatorSpy, pathFinderSpy, gitCommandsFactory);

        activator.tryActivateInPath(fakeUri).catch((err) => {
            done("Unexpected exception: " + err);
        }).then((result) => {
            assert.equal(result, undefined);
            done();
        });
    });

    test("should verify activation is passed", function (done) {
        when(pathFinderMock.find()).thenReturn(Promise.resolve("git"));
        when(isActiveValidatorMock.validate(anything(), anything())).thenReturn(Promise.resolve());
        const activator = new GitProviderActivator(anything(), isActiveValidatorSpy, pathFinderSpy, gitCommandsFactory);

        activator.tryActivateInPath(fakeUri).catch((err) => {
            done("Unexpected exception: " + err);
        }).then((result) => {
            assert.notEqual(result, undefined);
            done();
        });
    });
});
