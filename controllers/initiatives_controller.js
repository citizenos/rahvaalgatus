var O = require("oolong")
var Router = require("express").Router
var AppController = require("root/controllers/app_controller")
var FetchError = require("fetch-error")
var HttpError = require("standard-http-error")
var Initiative = require("root/lib/initiative")
var DateFns = require("date-fns")
var isOk = require("root/lib/http").isOk
var next = require("co-next")
var sleep = require("root/lib/promise").sleep
var api = require("root/lib/citizen_os")
var redirect = require("root/lib/middleware/redirect_middleware")
var EMPTY_INITIATIVE = {title: "", contact: {name: "", email: "", phone: ""}}
var UPDATE_ERR = "Invalid Attribute Value"

var TRANSLATIONS = O.map(require("root/lib/i18n").LANGUAGES, function(lang) {
	return O.filter(lang, (v, k) => k.indexOf("HWCRYPTO") >= 0)
})

exports.router = Router({mergeParams: true})

exports.router.get("/", redirect(302, "/"))

exports.router.get("/new", function(req, res) {
	res.render("initiatives/create", {attrs: EMPTY_INITIATIVE})
})

exports.router.post("/", next(function*(req, res) {
	var attrs = O.assign({}, EMPTY_INITIATIVE, {
		title: req.body.title,
		visibility: "private",

		// NOTE: CitizenOS or Etherpad saves all given whitespace as
		// non-breaking-spaces, so make sure to not have any around <body> or other
		// tags.
		description: `
			<!DOCTYPE HTML>
			<html><body><h1>${req.body.title}</h1><br><p>Body</p></body></html>
		`,
	})

	if (!req.body["accept-tos"]) res.render("initiative/create", {
		error: req.t("CONFIRM_I_HAVE_READ"),
		attrs: attrs
	})

	var created = yield req.api("/api/users/self/topics", {
		method: "POST",
		json: attrs
	}).catch(catchUserError)

	if (isOk(created)) {
		var initiative = created.body.data
		res.redirect(303, req.baseUrl + "/" + initiative.id)
	}
	else res.status(422).render("initiatives/create", {
		error: translateCitizenError(req.t, created.body.status),
		attrs: attrs
	})
}))

exports.router.get("/:id/deadline", AppController.read)

exports.router.use("/:id", next(function*(req, res, next) {
	var path = `/api/topics/${req.params.id}?include[]=vote`
	if (req.user) path = "/api/users/self" + path.slice(4)
	req.initiative = yield req.api(path).then(getBody)
	res.locals.initiative = req.initiative
	next()
}))

exports.router.get("/:id", function(req, res, next) {
	var initiative = req.initiative
	switch (initiative.status) {
		case "inProgress": req.url = req.path + "/discussion"; break
		case "voting": req.url = req.path + "/vote"; break
		case "followUp": req.url = req.path + "/events"; break
		default: return void next(new HttpError(403, "Unknown Status"))
	}

	next()
})

exports.router.put("/:id", next(function*(req, res) {
	var initiative = req.initiative

	var tmpl
	res.locals.subpage = initiative.status == "inProgress" ? "discussion" : "vote"
	var attrs = EMPTY_INITIATIVE

	if ("status" in req.body) {
		tmpl = "initiatives/update_for_parliament"
		if (!Initiative.isParliamentable(initiative)) throw new HttpError(401)
		if (req.body.status !== "followUp") throw new HttpError(422, UPDATE_ERR)
		if (req.body.contact == null) return void res.render(tmpl, {attrs: attrs})

		attrs = {
			status: req.body.status,
			contact: O.defaults(req.body.contact, EMPTY_INITIATIVE.contact)
		}
	}
	else if ("visibility" in req.body) {
		tmpl = "initiatives/update_for_publish"
		if (!Initiative.isPublishable(initiative)) throw new HttpError(401)
		if (req.body.visibility !== "public") throw new HttpError(422, UPDATE_ERR)
		if (req.body.endsAt == null) return void res.render(tmpl, {attrs: attrs})

		var endsAt = DateFns.endOfDay(new Date(req.body.endsAt))
		if (!Initiative.isDeadlineOk(new Date, endsAt))
			return void res.render(tmpl, {
				error: "Deadline must be between 3 days and a year from now.",
				attrs: attrs
			})

		attrs = {visibility: "public", endsAt: endsAt}
	}
	else throw new HttpError(422, "Invalid Attribute")

	var updated = yield req.api(`/api/users/self/topics/${initiative.id}`, {
		method: "PUT",
		json: attrs
	}).catch(catchUserError)

	if (isOk(updated)) {
		if ("status" in req.body)
			res.flash("notice", req.t("SENT_TO_PARLIAMENT_CONTENT"))
		else if ("visibility" in req.body)
			res.flash("notice", "Initiative is now public.")

		res.redirect(303, req.baseUrl + "/" + initiative.id)
	}
	else res.status(422).render(tmpl, {
		error: translateCitizenError(req.t, updated.body.status),
		attrs: attrs
	})
}))

exports.router.get("/:id/discussion", next(read.bind(null, "discussion")))
exports.router.get("/:id/vote", next(read.bind(null, "vote")))

exports.router.get("/:id/events", next(function*(req, res) {
	var initiative = req.initiative
	var events = yield api(`/api/topics/${initiative.id}/events`)
	events = events.body.data.rows

	res.render("initiatives/events", {
		subpage: "events",
		events: events,
	})
}))

exports.router.get("/:id/signable", next(function*(req, res) {
	var initiative = req.initiative
	var vote = initiative.vote

	var signable = yield api(`/api/topics/${initiative.id}/votes/${vote.id}`, {
		method: "POST",

		json: {
			options: [{optionId: req.query.optionId}],
			certificate: req.query.certificate
		}
	}).catch(catchUserError)

	if (isOk(signable)) res.json({
		token: signable.body.data.token,
		digest: signable.body.data.signedInfoDigest,
		hash: signable.body.data.signedInfoHashType
	})
	else res.status(422).json({
		error: translateCitizenError(req.t, signable.body.status)
	})
}))

exports.router.post("/:id/signature", next(function*(req, res) {
	var initiative = req.initiative
	var vote = initiative.vote

	res.locals.method = req.body.method

	switch (req.body.method) {
		case "id-card":
			var path = `/api/topics/${initiative.id}/votes/${vote.id}/sign`
			var signed = yield api(path, {
				method: "POST",
				json: {token: req.body.token, signatureValue: req.body.signature}
			}).catch(catchUserError)

			if (isOk(signed)) {
				res.flash("signed", signed.body.data.bdocUri)
				res.redirect(303, req.baseUrl + "/" + initiative.id)
			}
			else res.status(422).render("initiatives/signature/create", {
				error: translateCitizenError(req.t, signed.body.status)
			})
			break

		case "mobile-id":
			var signing = yield api(`/api/topics/${initiative.id}/votes/${vote.id}`, {
				method: "POST",
				json: {
					options: [{optionId: req.body.optionId}],
					pid: req.body.pid,
					phoneNumber: req.body.phoneNumber,
				}
			}).catch(catchUserError)

			if (isOk(signing)) {
				res.render("initiatives/signature/create", {
					code: signing.body.data.challengeID,
					poll: req.baseUrl + req.path + "?token=" + signing.body.data.token
				})
			}
			else res.status(422).render("initiatives/signature/create", {
				error: translateCitizenError(req.t, signed.body.status)
			})
			break

		default: throw new HttpError(422, "Unknown Signing Method")
	}
}))

exports.router.get("/:id/signature", next(function*(req, res) {
	var token = req.query.token
	if (token == null) throw new HttpError(400, "Missing Token")
	var initiative = req.initiative
	var signature = yield readSignature(initiative, token)

	switch (signature.statusCode) {
		case 200:
			res.flash("signed", signature.body.data.bdocUri)
			break

		default:
			res.flash("error", translateCitizenError(req.t, signature.body.status))
			break
	}

	res.redirect(303, req.baseUrl + "/" + initiative.id)
}))

function* read(subpage, req, res, next) {
	var initiative = req.initiative
	var path = `/api/topics/${initiative.id}/comments?orderBy=date`
	if (req.user) path = "/api/users/self" + path.slice(4)
	var comments = yield req.api(path)
	comments = comments.body.data.rows.map(normalizeComment)

	res.render("initiatives/read", {
		subpage: subpage,
		comments: comments,
		text: normalizeText(initiative.description),
		translations: TRANSLATIONS[req.lang]
	})
}

function* readSignature(initiative, token) {
	var vote = initiative.vote
	var path = `/api/topics/${initiative.id}/votes/${vote.id}/status`
	path += "?token=" + encodeURIComponent(token)

	RETRY: for (var i = 0; i < 60; ++i) {
		var res = yield api(path).catch(catchUserError)

		switch (res.statusCode) {
			case 200:
				if (res.body.status.code === 20001) {
					yield sleep(2500);
					continue RETRY;
				}
				// Fall through.

			default: return res
		}
	}

	throw new HttpError(500, "Mobile-Id Took Too Long")
}

function catchUserError(err) {
	if (err instanceof FetchError && err.code === 400) return err.response
	else throw err
}

function normalizeText(html) {
	return html.match(/<body>(.*)<\/body>/)[1]
}

function normalizeComment(comment) {
	comment.replies = comment.replies.rows
	return comment
}

function translateCitizenError(t, status) {
	return t(keyifyError(status.code)) || status.message
}

function keyifyError(citizenCode) { return `MSG_ERROR_${citizenCode}_VOTE` }
function getBody(res) { return res.body.data }
