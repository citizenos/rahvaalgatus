var Raven = require("raven")
var IncomingMessage = require("http").IncomingMessage
var FetchError = require("fetch-error")
var parseRequest = require("raven").parsers.parseRequest

module.exports = ErrorReporter

function ErrorReporter(dsn) {
	this.raven = new Raven.Client(dsn)
	this.raven.on("error", this.onError.bind(this))
	return this.report.bind(this)
}

ErrorReporter.prototype.logger = console

ErrorReporter.prototype.report = function(err, data) {
	if (data instanceof IncomingMessage) data = parseRequest(data)
	if (err instanceof FetchError) data.extra = serializeFetchError(err)
	this.raven.captureException(err, data)
}

ErrorReporter.prototype.onError = function(err) {
	this.logger.error(err)
}

function serializeFetchError(err) {
	var req = err.request
  return {request: {method: req.method, url: req.url}}
}

