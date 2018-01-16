"use strict";

import {assert} from "chai";
import {GitParser} from "../../../src/bll/cvsutils/git-parser";

suite("GitParser", () => {

    test("should verify parseStatusRow with one not staged change", function (done) {
        const testString = " M IMS/OM/Db/Oracle/TRDPatchXX_XX_Template.sql";
        try {
            const result = GitParser.parseStatusRow(testString);
            done(result);
        } catch (err) {
            done();
        }
    });

    test("should verify parseStatusRow with a staged change", function () {
        const testString = "M  src/main/java/ru/smt/EntryPoint.java";
        const result = GitParser.parseStatusRow(testString);
        assert.equal(result.relativePath, "src/main/java/ru/smt/EntryPoint.java");
        assert.equal(result.status, "M");
    });

    test("should verify parseReplacedPath with an incorrect status row", function (done) {
        const testString = "R  src/main/java/ru/smt/EntryPoint.java";
        try {
            const result = GitParser.parseReplacedPath(testString);
            done(result);
        } catch (err) {
            done();
        }
    });

    test("should verify parseReplacedPath with a correct status row", function () {
        const testString = "src/smt/speakers/HelloWorldSpeaker.java -> src/smt/speakers/HWSpeaker.java";
        const result = GitParser.parseReplacedPath(testString);
        assert.equal(result.relativePath, "src/smt/speakers/HWSpeaker.java");
        assert.equal(result.prevRelativePath, "src/smt/speakers/HelloWorldSpeaker.java");
    });
});
