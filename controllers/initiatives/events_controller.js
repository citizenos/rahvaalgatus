var O = require("oolong")
var Router = require("express").Router
var isOk = require("root/lib/http").isOk
var catch400 = require("root/lib/fetch").catch.bind(null, 400)
var catch401 = require("root/lib/fetch").catch.bind(null, 401)
var catch403 = require("root/lib/fetch").catch.bind(null, 403)
var translateCitizenError = require("root/lib/api").translateError
var next = require("co-next")
var EMPTY = Object.prototype
var EMPTY_EVENT = {subject: "", text: ""}

exports.router = Router({mergeParams: true})

exports.router.get("/new", function(req, res) {
	res.render("initiatives/events/create", {
		attrs: O.create(EMPTY_EVENT, {token: req.query.token})
	})
})

exports.router.post("/", next(function*(req, res) {
	var initiative = req.initiative
	var token = req.body.token || null

	// Currently an external or anonymous token requires the endpoint to be
	// separate from when the token is of the user. This will hopefully be
	// unified so endpoints are not dependent on token sources.
	var path = `/api/topics/${initiative.id}/events`
	if (token == null) path = "/api/users/self" + path.slice(4)

	var created = yield req.api(path, {
		method: "POST",
		json: {subject: req.body.subject, text: req.body.text},
		headers: token == null ? EMPTY : {Authorization: "Bearer "+ token}
	}).catch(catch400).catch(catch401).catch(catch403)

	if (isOk(created))
		res.redirect(303, req.baseUrl)
	else res.status(422).render("initiatives/events/create", {
		error: translateCitizenError(req.t, created.body),
		attrs: req.body
	})
}))
