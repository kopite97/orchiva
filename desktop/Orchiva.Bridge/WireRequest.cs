using System.Text.Json.Serialization;

namespace Orchiva.Bridge;

internal sealed record WireRequest(
    [property: JsonPropertyName("protocolVersion")] int ProtocolVersion,
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("method")] string Method,
    [property: JsonPropertyName("params")] object Parameters);
