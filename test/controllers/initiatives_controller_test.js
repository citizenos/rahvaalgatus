var O = require("oolong")
var Url = require("url")
var DateFns = require("date-fns")
var I18n = require("root/lib/i18n")
var Config = require("root/config")
var respond = require("root/test/fixtures").respond
var concat = Array.prototype.concat.bind(Array.prototype)
var UUID = "5f9a82a5-e815-440b-abe9-d17311b0b366"
var VOTES = require("root/config").votesRequired
var PARTNER_ID = Config.apiPartnerId
var EXTERNAL_PARTNER_ID = O.keys(Config.partners)[0]
var PARTNER_IDS = concat(PARTNER_ID, O.keys(Config.partners))
var ADMIN_COAUTHORS = Config.adminCoauthors

var PUBLISHABLE_DISCUSSION = {
	id: UUID,
	createdAt: new Date(2000, 0, 1),
	status: "inProgress",
	description: "<body><h1>My thoughts.</h1></body>",
	creator: {name: "John"},
	visibility: "private",
	permission: {level: "admin"}
}

var DISCUSSION = {
	id: UUID,
	createdAt: new Date(2000, 0, 1),
	status: "inProgress",
	description: "<body><h1>My thoughts.</h1></body>",
	creator: {name: "John"},
	visibility: "public",
	permission: {level: "read"}
}

var CLOSED_DISCUSSION = {
	id: UUID,
	sourcePartnerId: PARTNER_ID,
	status: "closed",
	description: "<body><h1>My thoughts.</h1></body>",
	creator: {name: "John"},
	permission: {level: "read"},
	events: {count: 0}
}

var CLOSED_EXTERNAL_DISCUSSION = {
	id: UUID,
	sourcePartnerId: EXTERNAL_PARTNER_ID,
	status: "closed",
	description: "<body><h1>My thoughts.</h1></body>",
	creator: {name: "John"},
	permission: {level: "read"},
	events: {count: 0}
}

var PROPOSABLE_DISCUSSION = {
	id: UUID,
	createdAt: new Date(2000, 0, 1),
	status: "inProgress",
	description: "<body><h1>My thoughts.</h1></body>",
	creator: {name: "John"},
	visibility: "public",
	permission: {level: "admin"}
}

var INITIATIVE = {
	id: UUID,
	status: "voting",
	description: "<body><h1>My thoughts.</h1></body>",
	creator: {name: "John"},
	permission: {level: "read"},

	vote: {
		id: "396b0e5b-cca7-4255-9238-19b464e60b65",
		options: {rows: [{value: "Yes", voteCount: 0}]}
	}
}

var PROCESSED_INITIATIVE = {
	id: UUID,
	status: "closed",
	description: "<body><h1>My thoughts.</h1></body>",
	creator: {name: "John"},
	permission: {level: "read"},
	vote: {options: {rows: [{value: "Yes", voteCount: 0}]}},
	events: {count: 1} // No actual events returned, it seems.
}

var EMPTY_COMMENTS_RES = {data: {rows: []}}

describe("InitiativesController", function() {
	require("root/test/web")()
	require("root/test/mitm")()
	beforeEach(require("root/test/mitm").router)

	describe("GET /", function() {
		describe("when not logged in", function() {
			it("must request initiatives", function*() {
				var requested = 0
				this.router.get("/api/topics", function(req, res) {
					++requested
					var query = Url.parse(req.url, true).query
					query["include[]"].must.be.a.permutationOf(["vote", "event"])
					query["sourcePartnerId[]"].must.be.a.permutationOf(PARTNER_IDS)

					respond({data: {rows: []}}, req, res)
				})

				var res = yield this.request("/initiatives")
				res.statusCode.must.equal(200)
				requested.must.equal(4)
			})

			it("must show processed initiative", function*() {
				this.router.get("/api/topics", function(req, res) {
					var initiatives
					switch (Url.parse(req.url, true).query.statuses) {
						case "closed": initiatives = [PROCESSED_INITIATIVE]; break
						default: initiatives = []
					}

					respond({data: {rows: initiatives}}, req, res)
				})
	
				var res = yield this.request("/initiatives")
				res.statusCode.must.equal(200)
				res.body.must.include(UUID)
			})

			it("must show closed discussions", function*() {
				this.router.get("/api/topics", function(req, res) {
					var initiatives
					switch (Url.parse(req.url, true).query.statuses) {
						case "closed": initiatives = [CLOSED_DISCUSSION]; break
						default: initiatives = []
					}

					respond({data: {rows: initiatives}}, req, res)
				})
	
				var res = yield this.request("/initiatives")
				res.statusCode.must.equal(200)
				res.body.must.include(UUID)
			})

			it("must not show closed discussions of other sites", function*() {
				this.router.get("/api/topics", function(req, res) {
					var initiatives
					switch (Url.parse(req.url, true).query.statuses) {
						case "closed": initiatives = [CLOSED_EXTERNAL_DISCUSSION]; break
						default: initiatives = []
					}

					respond({data: {rows: initiatives}}, req, res)
				})
	
				var res = yield this.request("/initiatives")
				res.statusCode.must.equal(200)
				res.body.must.not.include(UUID)
			})
		})
	})

	describe("GET /new", function() {
		describe("when logged in", function() {
			require("root/test/fixtures").user()

			it("must render", function*() {
				var res = yield this.request("/initiatives/new")
				res.statusCode.must.equal(200)
			})
		})
	})

	describe("POST /", function() {
		describe("when logged in", function() {
			require("root/test/fixtures").user()

			it("must escape title", function*() {
				var created = 0
				this.router.post("/api/users/self/topics", function(req, res) {
					++created
					req.headers.authorization.must.exist(0)

					var title = "Hello &lt;mike&gt;!"
					var html = I18n.t("et", "INITIATIVE_DEFAULT_HTML", {title: title})
					req.body.visibility.must.equal("private")
					req.body.description.must.equal(html)

					respond({data: {id: UUID}}, req, res)
				})

				var res = yield this.request("/initiatives", {
					method: "POST",
					form: {
						_csrf_token: this.csrfToken,
						"accept-tos": true,
						title: "Hello <mike>!"
					}
				})

				res.statusCode.must.equal(303)
				res.headers.location.must.equal("/initiatives/" + UUID)
				created.must.equal(1)
			})
		})
	})

	describe("GET /:id", function() {
		describe("when not logged in", function() {
			it("must request initiative", function*() {
				this.router.get(`/api/topics/${UUID}`, function(req, res) {
					var query = Url.parse(req.url, true).query
					query["include[]"].must.be.a.permutationOf(["vote", "event"])
					respond({data: DISCUSSION}, req, res)
				})

				this.router.get(`/api/topics/${UUID}/comments`,
					respond.bind(null, EMPTY_COMMENTS_RES))

				var res = yield this.request("/initiatives/" + UUID)
				res.statusCode.must.equal(200)
			})

			it("must render discussion", function*() {
				this.router.get(`/api/topics/${UUID}`,
					respond.bind(null, {data: DISCUSSION}))
				this.router.get(`/api/topics/${UUID}/comments`,
					respond.bind(null, EMPTY_COMMENTS_RES))

				var res = yield this.request("/initiatives/" + UUID)
				res.statusCode.must.equal(200)
			})
		})

		describe("when logged in", function() {
			require("root/test/fixtures").user()

			it("must render discussion", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`, respond.bind(null, {
					data: DISCUSSION
				}))

				this.router.get(`/api/users/self/topics/${UUID}/comments`,
					respond.bind(null, EMPTY_COMMENTS_RES)
				)
	
				var res = yield this.request("/initiatives/" + UUID)
				res.statusCode.must.equal(200)
			})

			// This was a bug noticed on Mar 24, 2017 where the UI translation strings
			// were not rendered on the page. They were used only for ID-card errors.
			it("must render UI strings when voting", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`, respond.bind(null, {
					data: INITIATIVE
				}))

				this.router.get(`/api/users/self/topics/${UUID}/comments`,
					respond.bind(null, EMPTY_COMMENTS_RES))

				var res = yield this.request("/initiatives/" + UUID)
				res.statusCode.must.equal(200)
				res.body.must.include("MSG_ERROR_HWCRYPTO_NO_CERTIFICATES")
			})

			it("must respond with 404 when API responds 403 Forbidden", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`, function(_req, res) {
					res.statusCode = 403
					res.end()
				})

				var res = yield this.request("/initiatives/" + UUID)
				res.statusCode.must.equal(404)
			})

			it("must respond with 404 when API responds 404 Not Found", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`, function(_req, res) {
					res.statusCode = 404
					res.end()
				})

				var res = yield this.request("/initiatives/" + UUID)
				res.statusCode.must.equal(404)
			})
		})
	})

	describe("PUT /:id", function() {
		describe("when logged in", function() {
			require("root/test/fixtures").user()

			it("must render update visibility page", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`,
					respond.bind(null, {data: PUBLISHABLE_DISCUSSION}))

				var res = yield this.request("/initiatives/" + UUID, {
					method: "PUT",
					form: {_csrf_token: this.csrfToken, visibility: "public"}
				})

				res.statusCode.must.equal(200)
			})

			it("must update visibility", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`,
					respond.bind(null, {data: PUBLISHABLE_DISCUSSION}))

				var today = DateFns.startOfDay(new Date)
				var endsAt = DateFns.endOfDay(DateFns.addDays(today, 5))

				var updated = 0
				this.router.put(`/api/users/self/topics/${UUID}`, function(req, res) {
					++updated
					req.body.must.eql({visibility: "public", endsAt: endsAt.toJSON()})
					res.end()
				})

				var res = yield this.request(`/initiatives/${UUID}`, {
					method: "PUT",
					form: {
						_csrf_token: this.csrfToken,
						visibility: "public",
						endsAt: endsAt.toJSON().slice(0, 10)
					}
				})

				updated.must.equal(1)
				res.statusCode.must.equal(303)
				res.headers.location.must.equal(`/initiatives/${UUID}`)
			})

			it("must add admin as a coauthor", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`,
					respond.bind(null, {data: PUBLISHABLE_DISCUSSION}))

				this.router.put(`/api/users/self/topics/${UUID}`, endRequest)

				var added = 0
				this.router.post(`/api/users/self/topics/${UUID}/members/users`,
					function(req, res) {
					++added
					req.body.must.eql([{userId: ADMIN_COAUTHORS[0], level: "admin"}])
					res.end()
				})

				var today = DateFns.startOfDay(new Date)
				var endsAt = DateFns.endOfDay(DateFns.addDays(today, 5))
				var res = yield this.request(`/initiatives/${UUID}`, {
					method: "PUT",
					form: {
						_csrf_token: this.csrfToken,
						visibility: "public",
						endsAt: endsAt.toJSON().slice(0, 10)
					}
				})

				added.must.equal(1)
				res.statusCode.must.equal(303)
			})

			it("must render update status for voting page", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`,
					respond.bind(null, {data: PROPOSABLE_DISCUSSION}))

				var res = yield this.request("/initiatives/" + UUID, {
					method: "PUT",
					form: {_csrf_token: this.csrfToken, status: "voting"}
				})

				res.statusCode.must.equal(200)
			})

			it("must update status", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`, respond.bind(null, {
					data: {
						id: UUID,
						status: "voting",
						description: "<body><h1>My thoughts.</h1></body>",
						creator: {name: "John"},
						permission: {level: "admin"},
						vote: {options: {rows: [{value: "Yes", voteCount: VOTES}]}}
					}
				}))

				var updated = 0
				this.router.put(`/api/users/self/topics/${UUID}`, function(req, res) {
					++updated
					req.body.must.eql({
						status: "followUp",
						contact: {name: "John", email: "john@example.com", phone: "42"}

					})
					res.end()
				})

				var res = yield this.request(`/initiatives/${UUID}`, {
					method: "PUT",
					form: {
						_csrf_token: this.csrfToken,
						status: "followUp",
						"contact[name]": "John",
						"contact[email]": "john@example.com",
						"contact[phone]": "42"
					}
				})

				updated.must.equal(1)
				res.statusCode.must.equal(303)
				res.headers.location.must.equal(`/initiatives/${UUID}`)
			})
		})
	})

	describe("PUT /:id/signature", function() {
		describe("when not logged in", function() {
			require("root/test/fixtures").csrf()

			it("must send mobile-id vote", function*() {
				this.router.get(`/api/topics/${UUID}`,
					respond.bind(null, {data: INITIATIVE}))

				var created = 0
				this.router.post(`/api/topics/${UUID}/votes/${INITIATIVE.vote.id}`,
					function(req, res) {
					++created
					req.body.must.eql({
						options: [{optionId: "0bf34d36-59cd-438f-afd1-9a3a779b78b0"}],
						pid: "11412090004",
						phoneNumber: "+37200000766",
					})

					respond({data: {challengeID: "1337", token: "abcdef"}}, req, res)
				})

				var res = yield this.request(`/initiatives/${UUID}/signature`, {
					method: "POST",
					form: {
						_csrf_token: this.csrfToken,
						method: "mobile-id",
						optionId: "0bf34d36-59cd-438f-afd1-9a3a779b78b0",
						pid: "11412090004",
						phoneNumber: "+37200000766"
					}
				})

				created.must.equal(1)
				res.statusCode.must.equal(200)
			})

			O.each({
				"00000766": "+37200000766",
				"37000000766": "37000000766",
				"37200000766": "37200000766",
				"37100000766": "37100000766",
				"+37000000766": "+37000000766",
				"+37200000766": "+37200000766"
			}, function(long, short) {
				it(`must transform mobile-id number ${short} to ${long}`, function*() {
					this.router.get(`/api/topics/${UUID}`,
						respond.bind(null, {data: INITIATIVE}))

					var created = 0
					this.router.post(`/api/topics/${UUID}/votes/${INITIATIVE.vote.id}`,
						function(req, res) {
						++created
						req.body.must.eql({
							options: [{optionId: "0bf34d36-59cd-438f-afd1-9a3a779b78b0"}],
							pid: "11412090004",
							phoneNumber: long,
						})

						respond({data: {challengeID: "1337", token: "abcdef"}}, req, res)
					})

					var res = yield this.request(`/initiatives/${UUID}/signature`, {
						method: "POST",
						form: {
							_csrf_token: this.csrfToken,
							method: "mobile-id",
							optionId: "0bf34d36-59cd-438f-afd1-9a3a779b78b0",
							pid: "11412090004",
							phoneNumber: short
						}
					})

					created.must.equal(1)
					res.statusCode.must.equal(200)
				})
			})
		})
	})
})

function endRequest(_req, res) { res.end() }
