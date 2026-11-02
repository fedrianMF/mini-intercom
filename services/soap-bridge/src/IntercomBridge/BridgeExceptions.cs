namespace IntercomBridge;

public sealed class UnmappableDocumentException(string fieldName) : Exception(fieldName)
{
    public string FieldName { get; } = fieldName;
}

public sealed class TransientException(string message, Exception? innerException = null)
    : Exception(message, innerException);

public sealed class PermanentException(string message) : Exception(message);
